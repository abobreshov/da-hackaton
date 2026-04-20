import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ErrorCode, WireError } from '@app/contracts';
import {
  EVENT_PUBLISHER,
  IEventPublisher,
} from '../../common/events/event-publisher.interface';
import {
  MODERATION_REPOSITORY,
  ModerationRepositoryPort,
  Role,
  RoomBanRow,
} from './moderation.types';

function wire(status: HttpStatus, code: ErrorCode, message: string): HttpException {
  const body: WireError = { code, message };
  return new HttpException(body, status);
}

interface BanMemberInput {
  roomId: number;
  adminId: number;
  userId: number;
}

interface RoleChangeInput {
  roomId: number;
  actorId: number;
  userId: number;
}

interface DeleteRoomInput {
  roomId: number;
  actorId: number;
}

/**
 * ModerationService — EPIC-06 room moderation.
 *
 * Authorization matrix (§4.5):
 *   - ban/unban/view-bans: owner + admin
 *   - promote/demote:      owner only (owner self-demote forbidden, AC-06-02)
 *   - delete room:         owner only
 *
 * Persistence is delegated to `ModerationRepositoryPort` so the service is
 * Drizzle-free + unit-testable. Audit-log writes are NOT done here: each
 * privileged action emits a domain event via `IEventPublisher` and the
 * `AuditSubscriber` (registered in `EventsModule`) translates the event
 * into an `AuditService.append(...)` call. This keeps the moderation
 * service ignorant of the audit module entirely.
 */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(MODERATION_REPOSITORY)
    private readonly repo: ModerationRepositoryPort,
    @Inject(EVENT_PUBLISHER)
    private readonly events: IEventPublisher,
  ) {}

  // ---------------------------------------------------------------------------

  private async assertAdminOrOwner(roomId: number, actorId: number): Promise<Role> {
    const role = await this.repo.roleOf(roomId, actorId);
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenException('admin or owner required');
    }
    return role;
  }

  private async assertOwner(roomId: number, actorId: number): Promise<void> {
    const role = await this.repo.roleOf(roomId, actorId);
    if (role !== 'owner') throw new ForbiddenException('owner required');
  }

  // ---------------------------------------------------------------------------

  async banMember(input: BanMemberInput): Promise<void> {
    await this.assertAdminOrOwner(input.roomId, input.adminId);

    const targetRole = await this.repo.roleOf(input.roomId, input.userId);
    if (!targetRole) {
      throw new NotFoundException('target user is not a member of this room');
    }
    if (targetRole === 'owner') {
      throw new ForbiddenException('cannot ban the room owner');
    }

    try {
      await this.repo.banMember({
        roomId: input.roomId,
        userId: input.userId,
        bannedBy: input.adminId,
      });
    } catch (err: any) {
      if (err?.code === '23505') {
        throw wire(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          'user is already banned from this room',
        );
      }
      throw err;
    }

    this.events.emit('room.ban', {
      actorId: input.adminId,
      roomId: input.roomId,
      userId: input.userId,
    });
  }

  async unbanMember(input: BanMemberInput): Promise<void> {
    await this.assertAdminOrOwner(input.roomId, input.adminId);

    await this.repo.unbanMember(input.roomId, input.userId);

    this.events.emit('room.unban', {
      actorId: input.adminId,
      roomId: input.roomId,
      userId: input.userId,
    });
  }

  async listBans(input: { roomId: number; viewerId: number }): Promise<RoomBanRow[]> {
    await this.assertAdminOrOwner(input.roomId, input.viewerId);
    return this.repo.listBans(input.roomId);
  }

  // ---------------------------------------------------------------------------

  async promote(input: RoleChangeInput): Promise<void> {
    await this.assertOwner(input.roomId, input.actorId);

    const targetRole = await this.repo.roleOf(input.roomId, input.userId);
    if (!targetRole) throw new NotFoundException('target user is not a member');
    if (targetRole === 'owner') throw new ForbiddenException('cannot promote the owner');
    if (targetRole === 'admin') return; // idempotent

    await this.repo.promoteMember(input.roomId, input.userId);

    this.events.emit('room.role.promote', {
      actorId: input.actorId,
      roomId: input.roomId,
      userId: input.userId,
      newRole: 'admin',
    });
  }

  async demote(input: RoleChangeInput): Promise<void> {
    if (input.actorId === input.userId) {
      // AC-06-02: owner cannot self-demote.
      throw new ForbiddenException('cannot demote yourself');
    }

    await this.assertOwner(input.roomId, input.actorId);

    const targetRole = await this.repo.roleOf(input.roomId, input.userId);
    if (!targetRole) throw new NotFoundException('target user is not a member');
    if (targetRole === 'owner') throw new ForbiddenException('cannot demote the owner');
    if (targetRole === 'member') return; // idempotent

    await this.repo.demoteMember(input.roomId, input.userId);

    this.events.emit('room.role.demote', {
      actorId: input.actorId,
      roomId: input.roomId,
      userId: input.userId,
      newRole: 'member',
    });
  }

  // ---------------------------------------------------------------------------

  async deleteRoom(input: DeleteRoomInput): Promise<void> {
    await this.assertOwner(input.roomId, input.actorId);

    const now = new Date();
    await this.repo.deleteRoom(input.roomId, now);

    this.events.emit('room.delete', {
      actorId: input.actorId,
      roomId: input.roomId,
    });
  }
}
