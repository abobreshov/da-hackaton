/**
 * Types + repository port for EPIC-02 §2.2.4 active-sessions surface.
 *
 * Each row in `user_sessions` represents a logged-in browser/device. The id
 * is a server-minted UUID (cookie-addressable, not enumerable). The id of
 * the *current* session is what the BFF will later embed in its session
 * cookie so the FE can render a "this device" badge — that wiring lives in
 * the next slice; this slice just persists + exposes the surface.
 */

export interface SessionRow {
  id: string;
  userId: number;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

export interface RecordLoginInput {
  userId: number;
  /** Optional pre-minted session id; repo defaults to a fresh UUID v4. */
  id?: string;
  userAgent?: string | null;
  ip?: string | null;
}

export interface RevokeInput {
  /** Session id (UUID). */
  id: string;
  /** Owning user id; revoke is scoped to prevent cross-user revocation. */
  userId: number;
}

export interface RevokeAllInput {
  /** Owning user id — every non-revoked row with this userId is flipped. */
  userId: number;
  /**
   * Optional session id to PRESERVE. When set, the caller's current
   * session stays active so the "Log out everywhere else" flow does not
   * log the caller out. Omit / pass `null` to revoke every session
   * including the caller's (full logout — used by account-delete +
   * password-change paths).
   */
  exceptSessionId?: string | null;
}

/**
 * Repository port. Drizzle adapter + in-memory fake both satisfy this.
 *
 * - `insertOnLogin` is fire-and-forget at the call site (auth-service catches
 *   transport errors so login itself never fails on a session-tracker hiccup).
 * - `listForUser` excludes revoked sessions and orders by `lastSeenAt DESC`.
 * - `revoke` is idempotent on already-revoked rows and a no-op for sessions
 *   that don't belong to `userId`.
 */
export interface SessionsRepositoryPort {
  insertOnLogin(input: RecordLoginInput): Promise<SessionRow>;
  listForUser(userId: number): Promise<SessionRow[]>;
  revoke(input: RevokeInput): Promise<{ revoked: boolean }>;
  /**
   * Fast "is this session id revoked?" probe — used by auth-service
   * `validateToken` to short-circuit a JWT-valid-but-revoked cookie. Returns
   * `true` if the row is missing OR `revoked_at IS NOT NULL` (fail-closed:
   * an unknown sid must not pass). Returns `false` only for an existing
   * non-revoked row.
   */
  isRevoked(sessionId: string): Promise<boolean>;
  /**
   * Bump `last_seen_at = NOW()` for the given session id when it exists and
   * is not revoked. Returns `{ touched: true }` on a successful UPDATE,
   * `{ touched: false }` for missing / already-revoked rows. Idempotent and
   * safe to fire-and-forget from auth-service `validateToken`.
   */
  touch(sessionId: string): Promise<{ touched: boolean }>;
  /**
   * Bulk revoke for a user. Flips `revoked_at = NOW()` on every row where
   * `userId` matches and `revoked_at IS NULL`. When `exceptSessionId` is
   * provided that one row is preserved (for the "Log out everywhere
   * else" flow). Returns the number of rows revoked.
   */
  revokeAll(input: RevokeAllInput): Promise<{ revokedCount: number }>;
}

export const SESSIONS_REPOSITORY = 'SESSIONS_REPOSITORY';
