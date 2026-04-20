export type RoomVisibility = 'public' | 'private';
export type MembershipRole = 'owner' | 'admin' | 'member';

export interface RoomRow {
  id: number;
  name: string;
  description: string | null;
  visibility: string;
  ownerId: number;
  createdAt: Date | null;
  deletedAt: Date | null;
}

export interface MembershipRow {
  roomId: number;
  userId: number;
  role: string;
  joinedAt: Date | null;
}

export interface InvitationRow {
  id: number;
  roomId: number;
  inviterId: number;
  inviteeId: number;
  createdAt: Date | null;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
}

export interface CreateRoomInput {
  ownerId: number;
  name: string;
  visibility: RoomVisibility;
  description?: string | null;
}

export interface InsertMembershipInput {
  roomId: number;
  userId: number;
  role: MembershipRole;
}

export interface InsertInvitationInput {
  roomId: number;
  inviterId: number;
  inviteeId: number;
}

/**
 * Partial-update shape for EPIC-05 AC-05-13 (owner PATCH). Fields left
 * `undefined` are not changed; explicit `null` on `description` clears it.
 */
export interface UpdateRoomInput {
  name?: string;
  description?: string | null;
  visibility?: RoomVisibility;
}

/**
 * Shape returned from `findMembersWithUsernames` — a join across
 * `room_memberships` + `users` used to populate the member pane on
 * `room.join` ack (EPIC-03 AC-03-09) and the BFF fanout fallback.
 */
export interface MemberWithUsername {
  userId: number;
  role: string;
  username: string;
}

/**
 * Port (interface) the service depends on; a Drizzle-backed implementation
 * and an in-memory test fake both satisfy it. Keeping the port in its own
 * file lets unit tests import the types without pulling the Drizzle / env
 * chain (which would require DATABASE_URL at test boot).
 */
export interface RoomsRepositoryPort {
  insertRoom(input: CreateRoomInput): Promise<RoomRow>;
  findRoomById(id: number): Promise<RoomRow | null>;
  listPublicRooms(): Promise<RoomRow[]>;
  listRoomsForUser(userId: number): Promise<RoomRow[]>;

  insertMembership(input: InsertMembershipInput): Promise<MembershipRow>;
  findMembership(roomId: number, userId: number): Promise<MembershipRow | null>;
  deleteMembership(roomId: number, userId: number): Promise<number>;

  findPendingInvitation(roomId: number, inviteeId: number): Promise<InvitationRow | null>;
  insertInvitation(input: InsertInvitationInput): Promise<InvitationRow>;

  /**
   * Join `room_memberships` × `users` for the given room. Returns members
   * with a username column projected from `users.name`. Used by the member
   * pane on `room.join` ack (EPIC-03 AC-03-09) and BFF fanout (EPIC-15
   * AC-15-13).
   */
  findMembersWithUsernames(roomId: number): Promise<MemberWithUsername[]>;

  /**
   * Partial-update for EPIC-05 AC-05-13. Returns the updated row or null
   * if the row is missing / soft-deleted. The service layer has already
   * enforced the owner-only rule before calling.
   */
  updateRoom(id: number, patch: UpdateRoomInput): Promise<RoomRow | null>;
}

export const ROOMS_REPOSITORY = 'ROOMS_REPOSITORY';
