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
}

export const ROOMS_REPOSITORY = 'ROOMS_REPOSITORY';
