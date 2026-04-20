/**
 * Types + repository port for EPIC-07 messaging. Mirrors the rooms pattern
 * (port in its own file) so unit tests can import the types without pulling
 * the Drizzle / env chain.
 */

/** Row shape returned by the repo. `id` + `replyTo` are bigints in PG
 *  (`messages.id` is BIGSERIAL). Keep as native `bigint` here and let the
 *  TCP/JSON boundary serialise to string elsewhere. */
export interface MessageRow {
  id: bigint;
  roomId: number | null;
  dmId: number | null;
  authorId: number;
  body: string;
  replyTo: bigint | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date | null;
}

export interface DmChannelRow {
  id: number;
  userLow: number;
  userHigh: number;
  createdAt: Date | null;
  frozenAt: Date | null;
}

/** Input to the atomic insert. Either roomId xor dmId is non-null; service
 *  enforces the XOR before calling. */
export interface InsertMessageInput {
  roomId: number | null;
  dmId: number | null;
  authorId: number;
  body: string;
  replyTo?: bigint | null;
}

export interface ListCursor {
  /** Composite cursor — both halves required (AC-07-20). */
  createdAt: Date;
  id: bigint;
}

export interface ListMessagesInput {
  roomId?: number;
  dmId?: number;
  before?: ListCursor;
  limit: number;
}

export interface SinceMessagesInput {
  roomId?: number;
  dmId?: number;
  /** `lastSeenId` — caller wants everything strictly greater. */
  lastSeenId: bigint;
  limit: number;
}

/**
 * Repository port. A Drizzle-backed adapter and an in-memory test fake both
 * satisfy this interface.
 */
export interface MessagesRepositoryPort {
  /**
   * AC-07-16 — lazy upsert. Canonical ordering `user_low < user_high`. The
   * real adapter does this via `INSERT ... ON CONFLICT (user_low, user_high)
   * DO UPDATE SET id = dm_channels.id RETURNING id` so we always get an id
   * back — no follow-up SELECT race.
   */
  upsertDmChannel(userA: number, userB: number): Promise<DmChannelRow>;

  /**
   * AC-07-19 — atomic frozen-guard insert for DM path.
   * Executes `INSERT INTO messages ... SELECT :vals WHERE NOT EXISTS (SELECT 1
   * FROM dm_channels WHERE id = :dmId AND frozen_at IS NOT NULL) RETURNING *`.
   * Returns null when 0 rows affected (DM is frozen). Caller maps to 403.
   */
  insertMessageIfDmNotFrozen(input: InsertMessageInput): Promise<MessageRow | null>;

  /** Room-path insert — service has already asserted membership. */
  insertMessage(input: InsertMessageInput): Promise<MessageRow>;

  findMessageById(id: bigint): Promise<MessageRow | null>;

  /**
   * Soft-delete update — sets deleted_at, keeps body for audit. Returns the
   * updated row (or null if not found / already gone). Note: caller has
   * already done the authorship / admin check.
   */
  softDeleteMessage(id: bigint): Promise<MessageRow | null>;

  /**
   * Edit body + stamp `edited_at`. Guarded on `deleted_at IS NULL` inside the
   * WHERE — returns null when the row is already deleted or missing.
   */
  updateMessageBody(id: bigint, body: string): Promise<MessageRow | null>;

  /**
   * Keyset backwards-scan (AC-07-20). `before` is exclusive. Filters
   * `deleted_at IS NULL`. Ordered `created_at DESC, id DESC`.
   */
  listMessages(input: ListMessagesInput): Promise<MessageRow[]>;

  /**
   * Forward hydrate (EPIC-03 AC-03-09): `WHERE id > :lastSeenId` in the same
   * scope (room or dm). Ordered `id ASC`.
   */
  listMessagesSince(input: SinceMessagesInput): Promise<MessageRow[]>;

  /**
   * Resolve the DM channel between two users (canonical order inside the
   * adapter). Null if it hasn't been created yet. Used by GET
   * /api/v1/dms/:userId/messages — we don't want to create a channel just
   * because someone scrolled the DM with no history.
   */
  findDmChannel(userA: number, userB: number): Promise<DmChannelRow | null>;
}

export const MESSAGES_REPOSITORY = 'MESSAGES_REPOSITORY';
