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
}

export const SESSIONS_REPOSITORY = 'SESSIONS_REPOSITORY';
