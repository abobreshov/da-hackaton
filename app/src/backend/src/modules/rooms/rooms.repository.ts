import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { rooms, roomMemberships, roomInvitations, users } from '../../database/schema';
import {
  CreateRoomInput,
  InsertInvitationInput,
  InsertMembershipInput,
  InvitationRow,
  MemberWithUsername,
  MembershipRow,
  RoomRow,
  RoomsRepositoryPort,
  UpdateRoomInput,
} from './rooms.types';

/**
 * Drizzle-backed repository. Each method is a one-shot query; transactions
 * for multi-step flows (create-room-and-seed-owner-membership) are owned by
 * the service so a failure in step 2 surfaces cleanly and the caller can
 * retry (the unique-name index will flag the orphan).
 */
@Injectable()
export class DrizzleRoomsRepository implements RoomsRepositoryPort {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async insertRoom(input: CreateRoomInput): Promise<RoomRow> {
    const [row] = await this.db
      .insert(rooms)
      .values({
        name: input.name,
        description: input.description ?? null,
        visibility: input.visibility,
        ownerId: input.ownerId,
      })
      .returning();
    return row as unknown as RoomRow;
  }

  async findRoomById(id: number): Promise<RoomRow | null> {
    const [row] = await this.db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, id), isNull(rooms.deletedAt)))
      .limit(1);
    return (row as unknown as RoomRow) ?? null;
  }

  async listPublicRooms(): Promise<RoomRow[]> {
    const list = await this.db
      .select()
      .from(rooms)
      .where(and(eq(rooms.visibility, 'public'), isNull(rooms.deletedAt)));
    return list as unknown as RoomRow[];
  }

  async listRoomsForUser(userId: number): Promise<RoomRow[]> {
    const list = await this.db
      .select({
        id: rooms.id,
        name: rooms.name,
        description: rooms.description,
        visibility: rooms.visibility,
        ownerId: rooms.ownerId,
        createdAt: rooms.createdAt,
        deletedAt: rooms.deletedAt,
      })
      .from(roomMemberships)
      .innerJoin(rooms, eq(rooms.id, roomMemberships.roomId))
      .where(and(eq(roomMemberships.userId, userId), isNull(rooms.deletedAt)));
    return list as unknown as RoomRow[];
  }

  async insertMembership(input: InsertMembershipInput): Promise<MembershipRow> {
    const [row] = await this.db
      .insert(roomMemberships)
      .values({ roomId: input.roomId, userId: input.userId, role: input.role })
      .returning();
    return row as unknown as MembershipRow;
  }

  async findMembership(roomId: number, userId: number): Promise<MembershipRow | null> {
    const [row] = await this.db
      .select()
      .from(roomMemberships)
      .where(and(eq(roomMemberships.roomId, roomId), eq(roomMemberships.userId, userId)))
      .limit(1);
    return (row as unknown as MembershipRow) ?? null;
  }

  async deleteMembership(roomId: number, userId: number): Promise<number> {
    const result = await this.db
      .delete(roomMemberships)
      .where(and(eq(roomMemberships.roomId, roomId), eq(roomMemberships.userId, userId)))
      .returning({ userId: roomMemberships.userId });
    return result.length;
  }

  async findPendingInvitation(roomId: number, inviteeId: number): Promise<InvitationRow | null> {
    const [row] = await this.db
      .select()
      .from(roomInvitations)
      .where(
        and(
          eq(roomInvitations.roomId, roomId),
          eq(roomInvitations.inviteeId, inviteeId),
          isNull(roomInvitations.acceptedAt),
          isNull(roomInvitations.rejectedAt),
        ),
      )
      .limit(1);
    return (row as unknown as InvitationRow) ?? null;
  }

  async insertInvitation(input: InsertInvitationInput): Promise<InvitationRow> {
    const [row] = await this.db
      .insert(roomInvitations)
      .values({
        roomId: input.roomId,
        inviterId: input.inviterId,
        inviteeId: input.inviteeId,
      })
      .returning();
    return row as unknown as InvitationRow;
  }

  async updateRoom(id: number, patch: UpdateRoomInput): Promise<RoomRow | null> {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.visibility !== undefined) set.visibility = patch.visibility;
    if (Object.keys(set).length === 0) {
      return this.findRoomById(id);
    }
    const [row] = await this.db
      .update(rooms)
      .set(set)
      .where(and(eq(rooms.id, id), isNull(rooms.deletedAt)))
      .returning();
    return (row as unknown as RoomRow) ?? null;
  }

  async findMembersWithUsernames(roomId: number): Promise<MemberWithUsername[]> {
    const list = await this.db
      .select({
        userId: roomMemberships.userId,
        role: roomMemberships.role,
        username: users.name,
      })
      .from(roomMemberships)
      .innerJoin(users, eq(users.id, roomMemberships.userId))
      .where(eq(roomMemberships.roomId, roomId));
    return list as unknown as MemberWithUsername[];
  }
}
