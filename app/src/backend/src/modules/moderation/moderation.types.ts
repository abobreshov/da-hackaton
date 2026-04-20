/**
 * Types + repository port for EPIC-06 moderation. Mirrors the rooms / messages
 * pattern (port in its own file) so unit tests can import the types without
 * pulling the Drizzle / env chain.
 *
 * The service depends on `ModerationRepositoryPort`; the Drizzle adapter
 * (`DrizzleModerationRepository`) and an in-memory test fake both satisfy it.
 */

export type Role = 'owner' | 'admin' | 'member';

export interface RoomBanRow {
  roomId: number;
  userId: number;
  bannedBy: number;
  bannedAt: Date | null;
}

export interface BanMemberRepoInput {
  roomId: number;
  userId: number;
  bannedBy: number;
}

/**
 * Repository port used by `ModerationService`. All database access for the
 * moderation domain goes through this surface so the service stays free of
 * Drizzle / schema concerns.
 *
 * `banMember` runs the ban-insert + membership-delete inside a single
 * transaction at the adapter level so the table snapshot never contains
 * both rows (AC-06-05/06/09). The adapter is expected to re-throw Postgres
 * unique-violation errors (`err.code === '23505'`) unchanged — the service
 * maps them to a wire-level CONFLICT.
 */
export interface ModerationRepositoryPort {
  /**
   * Return the role of `userId` in `roomId`, or `null` when they are not a
   * member (used for owner/admin gates).
   */
  roleOf(roomId: number, userId: number): Promise<Role | null>;

  /**
   * Atomically insert a row in `room_bans` and delete the corresponding
   * `room_memberships` row. Throws the underlying Postgres error on
   * unique-violation so the caller can map it to CONFLICT.
   */
  banMember(input: BanMemberRepoInput): Promise<void>;

  unbanMember(roomId: number, userId: number): Promise<void>;

  listBans(roomId: number): Promise<RoomBanRow[]>;

  /** `role = 'admin'`. */
  promoteMember(roomId: number, userId: number): Promise<void>;

  /** `role = 'member'`. */
  demoteMember(roomId: number, userId: number): Promise<void>;

  /** Soft-delete the room (`deleted_at = now`). */
  deleteRoom(roomId: number, deletedAt: Date): Promise<void>;
}

export const MODERATION_REPOSITORY = Symbol('MODERATION_REPOSITORY');
