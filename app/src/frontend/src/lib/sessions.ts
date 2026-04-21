import { apiFetch } from './api-client';

/**
 * Active sessions API client (M4 — T26).
 *
 * Wraps the BFF session-management endpoints. Shape follows the spec at
 * `mng/specs/14-session-revoke.md` — list returns the caller's active
 * refresh-token sessions; revoke deletes one by id.
 */

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  ip: string | null;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  lastSeenAt: string;
  /** True for the row corresponding to the calling browser's session. */
  current: boolean;
}

export interface SessionsResponse {
  sessions: SessionSummary[];
}

/** Snapshot of all active sessions for the caller. */
export const listSessions = (): Promise<SessionsResponse> =>
  apiFetch<SessionsResponse>('/api/v1/sessions');

/** Revoke a single session by id. Resolves on 204. */
export const revokeSession = (id: string): Promise<void> =>
  apiFetch<void>(`/api/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
