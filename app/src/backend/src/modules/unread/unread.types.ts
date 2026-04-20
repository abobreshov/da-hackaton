/**
 * Types + repository port for EPIC-09 unread tracking.
 *
 * The `user_last_read` table is scoped per (user, room|dm) with XOR CHECK
 * and a functional UNIQUE index `(user_id, COALESCE(room_id,0), COALESCE(dm_id,0))`.
 * Counts are cheap cursor scans on `messages.id > last_read_id`, capped at
 * 99 for UI.
 */

/** Per-scope unread count for a single user. */
export interface RoomUnread {
  roomId: number;
  count: number;
}

export interface DmUnread {
  dmId: number;
  count: number;
}

export interface UnreadCounts {
  rooms: RoomUnread[];
  dms: DmUnread[];
}

export interface MarkReadInput {
  userId: number;
  roomId?: number;
  dmId?: number;
  lastReadId: bigint;
}

export interface CountSinceInput {
  userId: number;
  roomId?: number;
  dmId?: number;
}

/** Hard UI cap per AC-09-03 — render "99+" beyond this. */
export const UNREAD_CAP = 99;

/**
 * Repository port. Drizzle adapter + in-memory fake both satisfy this.
 * Implementations are responsible for the functional-index upsert on
 * markRead and for applying the 99 cap on counts.
 */
export interface UnreadRepositoryPort {
  /**
   * AC-09-06 upsert keyed by `(user_id, COALESCE(room_id,0), COALESCE(dm_id,0))`.
   * Sets `last_read_id = :lastReadId, last_read_at = NOW()` on conflict.
   */
  upsertLastRead(input: MarkReadInput): Promise<void>;

  /**
   * Per-room unread counts for `userId`. Room scope = rooms the user is a
   * member of. Count = messages.id > COALESCE(last_read_id, 0) AND
   * deleted_at IS NULL. Capped at {@link UNREAD_CAP}.
   */
  unreadRoomsFor(userId: number): Promise<RoomUnread[]>;

  /**
   * Per-DM unread counts for `userId`. DM scope = dm_channels where the user
   * is either `user_low` or `user_high`. Same cap applies.
   */
  unreadDmsFor(userId: number): Promise<DmUnread[]>;

  /**
   * Single-scope count — used for WS `unread.changed` payload on a new
   * message delivery. Capped at {@link UNREAD_CAP}.
   */
  countSince(input: CountSinceInput): Promise<number>;
}

export const UNREAD_REPOSITORY = 'UNREAD_REPOSITORY';
