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
  MemberWithUsername,
  MembershipRole,
  MembershipRow,
  RoomRow,
  ROOMS_REPOSITORY,
  RoomsRepositoryPort,
  RoomVisibility,
  UpdateRoomInput,
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

export interface EnsureMemberParams {
  roomId: number;
  userId: number;
}

export interface UpdateRoomParams {
  roomId: number;
  actorId: number;
  patch: UpdateRoomInput;
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
     
    void inviterMembership;
  }

  /**
   * EPIC-03 AC-03-09 + EPIC-15 AC-15-13. Returns the joined list of
   * `{ userId, role, username }` for the BFF fanout and `room.join` ack
   * member pane. Throws NotFoundException when the room is missing or
   * soft-deleted — callers (BFF) map to a NOT_FOUND WireError.
   */
  async membersOf(roomId: number): Promise<{ members: MemberWithUsername[] }> {
    await this.requireRoom(roomId);
    const members = await this.repo.findMembersWithUsernames(roomId);
    return { members };
  }

  /**
   * EPIC-15 AC-15-13. Fast auth check used by BFF before delivering
   * `room.*` WebSocket frames. Returns `{ ok: true }` when the caller has
   * a membership row; otherwise throws ForbiddenException (FORBIDDEN
   * WireError). Missing / soft-deleted rooms throw NotFoundException.
   *
   * Ban handling: `room_bans` removes the membership row at ban time, so
   * membership presence alone is sufficient — no separate ban check here.
   */
  async ensureMember(params: EnsureMemberParams): Promise<{ ok: true }> {
    await this.requireRoom(params.roomId);
    const membership = await this.repo.findMembership(params.roomId, params.userId);
    if (!membership) {
      throw new ForbiddenException('not a member of this room');
    }
    return { ok: true };
  }

  /**
   * EPIC-05 AC-05-13. Owner-only partial update of name / description /
   * visibility. Unique name collision surfaces as ConflictException (→ 409
   * WireError on the BFF). Empty patches are a no-op returning the current
   * row so idempotent PATCH retries stay safe.
   */
  async update(params: UpdateRoomParams): Promise<RoomRow> {
    const room = await this.requireRoom(params.roomId);
    if (room.ownerId !== params.actorId) {
      throw new ForbiddenException('only the owner can update this room');
    }

    const patch = params.patch ?? {};

    if (patch.visibility !== undefined && !VALID_VISIBILITY.has(patch.visibility)) {
      throw new BadRequestException(`invalid visibility: ${String(patch.visibility)}`);
    }
    if (patch.name !== undefined && (!patch.name || patch.name.trim().length === 0)) {
      throw new BadRequestException('name may not be empty');
    }

    // Empty patch → no DB round-trip; return current row.
    if (
      patch.name === undefined &&
      patch.description === undefined &&
      patch.visibility === undefined
    ) {
      return room;
    }

    let updated: RoomRow | null;
    try {
      updated = await this.repo.updateRoom(room.id, patch);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(`room name "${patch.name}" already taken`);
      }
      throw err;
    }
    if (!updated) {
      // Raced with a soft-delete; treat as gone.
      throw new NotFoundException(`room ${room.id} not found`);
    }
    return updated;
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
