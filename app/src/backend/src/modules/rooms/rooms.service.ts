import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvitationRow,
  MembershipRole,
  MembershipRow,
  RoomRow,
  ROOMS_REPOSITORY,
  RoomsRepositoryPort,
  RoomVisibility,
} from './rooms.types';

export interface CreateRoomParams {
  ownerId: number;
  name: string;
  visibility: RoomVisibility;
  description?: string | null;
}

export interface JoinLeaveParams {
  userId: number;
  roomId: number;
}

export interface InviteParams {
  inviterId: number;
  inviteeId: number;
  roomId: number;
}

const VALID_VISIBILITY: ReadonlySet<string> = new Set(['public', 'private']);
const ADMIN_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

/**
 * EPIC-05 domain service. Business rules live here; persistence goes through
 * the injected repository port so we can unit-test without Postgres.
 */
@Injectable()
export class RoomsService {
  constructor(
    @Inject(ROOMS_REPOSITORY)
    private readonly repo: RoomsRepositoryPort,
  ) {}

  async create(params: CreateRoomParams): Promise<RoomRow> {
    if (!VALID_VISIBILITY.has(params.visibility)) {
      throw new BadRequestException(`invalid visibility: ${String(params.visibility)}`);
    }
    if (!params.name || params.name.trim().length === 0) {
      throw new BadRequestException('name is required');
    }

    let room: RoomRow;
    try {
      room = await this.repo.insertRoom({
        ownerId: params.ownerId,
        name: params.name,
        visibility: params.visibility,
        description: params.description ?? null,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(`room name "${params.name}" already taken`);
      }
      throw err;
    }

    // Seed owner membership. If this fails we surface the error — the caller
    // can retry; a stranded room is harmless (next retry will see the name
    // collision and we rely on that feedback).
    await this.repo.insertMembership({
      roomId: room.id,
      userId: params.ownerId,
      role: 'owner',
    });

    return room;
  }

  async catalog(): Promise<RoomRow[]> {
    return this.repo.listPublicRooms();
  }

  async listMy(userId: number): Promise<RoomRow[]> {
    return this.repo.listRoomsForUser(userId);
  }

  async join(params: JoinLeaveParams): Promise<MembershipRow> {
    const room = await this.requireRoom(params.roomId);

    const existing = await this.repo.findMembership(room.id, params.userId);
    if (existing) return existing;

    if (room.visibility === 'private') {
      const invite = await this.repo.findPendingInvitation(room.id, params.userId);
      if (!invite) {
        throw new ForbiddenException('private room requires invitation');
      }
    } else if (room.visibility !== 'public') {
      throw new ForbiddenException('room is not joinable');
    }

    try {
      return await this.repo.insertMembership({
        roomId: room.id,
        userId: params.userId,
        role: 'member',
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Racy double-join — treat as success.
        const again = await this.repo.findMembership(room.id, params.userId);
        if (again) return again;
      }
      throw err;
    }
  }

  async leave(params: JoinLeaveParams): Promise<void> {
    const room = await this.requireRoom(params.roomId);

    if (room.ownerId === params.userId) {
      throw new ForbiddenException('owner cannot leave own room');
    }

    const removed = await this.repo.deleteMembership(room.id, params.userId);
    if (removed === 0) {
      throw new NotFoundException('user is not a member of this room');
    }
  }

  async invite(params: InviteParams): Promise<InvitationRow> {
    const room = await this.requireRoom(params.roomId);

    const inviterMembership = await this.requireRole(room.id, params.inviterId, ADMIN_ROLES);

    // Defensive sanity checks
    if (params.inviteeId === params.inviterId) {
      throw new BadRequestException('cannot invite yourself');
    }

    try {
      return await this.repo.insertInvitation({
        roomId: room.id,
        inviterId: params.inviterId,
        inviteeId: params.inviteeId,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('invitation already exists for this user');
      }
      throw err;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    void inviterMembership;
  }

  // ——— helpers ———

  private async requireRoom(roomId: number): Promise<RoomRow> {
    const room = await this.repo.findRoomById(roomId);
    if (!room) throw new NotFoundException(`room ${roomId} not found`);
    return room;
  }

  private async requireRole(
    roomId: number,
    userId: number,
    allowed: ReadonlySet<string>,
  ): Promise<MembershipRow> {
    const membership = await this.repo.findMembership(roomId, userId);
    if (!membership || !allowed.has(membership.role as MembershipRole)) {
      throw new ForbiddenException('insufficient role for this operation');
    }
    return membership;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '23505';
}
