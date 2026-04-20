import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { ErrorCode, WireError } from '@app/contracts';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { roomBans, roomMemberships, rooms } from '../../database/schema';
import { AuditService } from '../audit/audit.service';

function wire(status: HttpStatus, code: ErrorCode, message: string): HttpException {
  const body: WireError = { code, message };
  return new HttpException(body, status);
}

type Role = 'owner' | 'admin' | 'member';

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
 * `banMember` + `unbanMember` include the ban list write AND the
 * corresponding membership delete inside the same transaction so the
 * table snapshot never contains both rows (AC-06-05/06/09). Audit append
 * is best-effort and runs post-commit.
 */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------

  private async roleOf(roomId: number, userId: number): Promise<Role | null> {
    const rows = await (this.db as any)
      .select()
      .from(roomMemberships)
      .where(and(eq(roomMemberships.roomId, roomId), eq(roomMemberships.userId, userId)))
      .limit(1);
    return rows[0]?.role ?? null;
  }

  private async assertAdminOrOwner(roomId: number, actorId: number): Promise<Role> {
    const role = await this.roleOf(roomId, actorId);
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenException('admin or owner required');
    }
    return role;
  }

  private async assertOwner(roomId: number, actorId: number): Promise<void> {
    const role = await this.roleOf(roomId, actorId);
    if (role !== 'owner') throw new ForbiddenException('owner required');
  }

  // ---------------------------------------------------------------------------

  async banMember(input: BanMemberInput): Promise<void> {
    await this.assertAdminOrOwner(input.roomId, input.adminId);

    const targetRole = await this.roleOf(input.roomId, input.userId);
    if (!targetRole) {
      throw new NotFoundException('target user is not a member of this room');
    }
    if (targetRole === 'owner') {
      throw new ForbiddenException('cannot ban the room owner');
    }

    try {
      await (this.db as any).transaction(async (tx: any) => {
        await tx.insert(roomBans).values({
          roomId: input.roomId,
          userId: input.userId,
          bannedBy: input.adminId,
        });
        await tx
          .delete(roomMemberships)
          .where(
            and(
              eq(roomMemberships.roomId, input.roomId),
              eq(roomMemberships.userId, input.userId),
            ),
          );
      });
    } catch (err: any) {
      if (err?.code === '23505') {
        throw wire(HttpStatus.CONFLICT, ErrorCode.CONFLICT, 'user is already banned from this room');
      }
      throw err;
    }

    await this.audit.append({
      actorId: input.adminId,
      actorType: 'admin',
      action: 'room.ban',
      targetType: 'user',
      targetId: BigInt(input.userId),
      metadata: { roomId: input.roomId },
    });
  }

  async unbanMember(input: BanMemberInput): Promise<void> {
    await this.assertAdminOrOwner(input.roomId, input.adminId);

    await (this.db as any)
      .delete(roomBans)
      .where(and(eq(roomBans.roomId, input.roomId), eq(roomBans.userId, input.userId)));

    await this.audit.append({
      actorId: input.adminId,
      actorType: 'admin',
      action: 'room.unban',
      targetType: 'user',
      targetId: BigInt(input.userId),
      metadata: { roomId: input.roomId },
    });
  }

  async listBans(input: { roomId: number; viewerId: number }): Promise<any[]> {
    await this.assertAdminOrOwner(input.roomId, input.viewerId);

    const rows = await (this.db as any)
      .select()
      .from(roomBans)
      .where(eq(roomBans.roomId, input.roomId))
      .orderBy(desc(roomBans.bannedAt));
    return rows;
  }

  // ---------------------------------------------------------------------------

  async promote(input: RoleChangeInput): Promise<void> {
    await this.assertOwner(input.roomId, input.actorId);

    const targetRole = await this.roleOf(input.roomId, input.userId);
    if (!targetRole) throw new NotFoundException('target user is not a member');
    if (targetRole === 'owner') throw new ForbiddenException('cannot promote the owner');
    if (targetRole === 'admin') return; // idempotent

    await (this.db as any)
      .update(roomMemberships)
      .set({ role: 'admin' })
      .where(and(eq(roomMemberships.roomId, input.roomId), eq(roomMemberships.userId, input.userId)));

    await this.audit.append({
      actorId: input.actorId,
      actorType: 'admin',
      action: 'room.role.promote',
      targetType: 'user',
      targetId: BigInt(input.userId),
      metadata: { roomId: input.roomId, newRole: 'admin' },
    });
  }

  async demote(input: RoleChangeInput): Promise<void> {
    if (input.actorId === input.userId) {
      // AC-06-02: owner cannot self-demote.
      throw new ForbiddenException('cannot demote yourself');
    }

    await this.assertOwner(input.roomId, input.actorId);

    const targetRole = await this.roleOf(input.roomId, input.userId);
    if (!targetRole) throw new NotFoundException('target user is not a member');
    if (targetRole === 'owner') throw new ForbiddenException('cannot demote the owner');
    if (targetRole === 'member') return; // idempotent

    await (this.db as any)
      .update(roomMemberships)
      .set({ role: 'member' })
      .where(and(eq(roomMemberships.roomId, input.roomId), eq(roomMemberships.userId, input.userId)));

    await this.audit.append({
      actorId: input.actorId,
      actorType: 'admin',
      action: 'room.role.demote',
      targetType: 'user',
      targetId: BigInt(input.userId),
      metadata: { roomId: input.roomId, newRole: 'member' },
    });
  }

  // ---------------------------------------------------------------------------

  async deleteRoom(input: DeleteRoomInput): Promise<void> {
    await this.assertOwner(input.roomId, input.actorId);

    const now = new Date();
    await (this.db as any)
      .update(rooms)
      .set({ deletedAt: now })
      .where(eq(rooms.id, input.roomId));

    await this.audit.append({
      actorId: input.actorId,
      actorType: 'admin',
      action: 'room.delete',
      targetType: 'room',
      targetId: BigInt(input.roomId),
      metadata: { roomId: input.roomId },
    });
  }
}
