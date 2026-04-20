import { apiFetch } from './api-client';

/**
 * Frontend-facing session shape.
 *
 * The server wire shape is OIDC-aligned (`sub: 'u:<id>' | 'a:<id>'`, `type`,
 * `email`, `name`, `scopes`). We keep a flattened numeric `id` on the FE so
 * route code doesn't have to care about the prefix — see {@link fromWire}
 * below for the projection. When real OIDC lands, `sub` stays on the wire
 * and only `fromWire()` needs to move.
 */
export interface Session {
  /** Numeric id — derived from the wire `sub`. Kept to avoid cascading FE edits. */
  id: number;
  type: 'user' | 'admin';
  email: string;
  name: string;
  scopes: string[];
}

/**
 * Raw `/auth/session` (and `/auth/login` / `/auth/register`) payload.
 *
 * Intentionally structural + permissive: BFF currently returns its internal
 * session blob directly via `{ ...req.session, csrfToken }`, so anything
 * beyond the claims we care about (e.g. `iat`, `exp`, `csrfToken`) flows
 * through harmlessly.
 */
export interface WireSession {
  sub: string;
  type: 'user' | 'admin';
  email: string;
  name: string;
  scopes?: string[] | null;
}

/**
 * Project the OIDC wire shape onto the FE-internal `Session`. Throws on a
 * malformed sub so callers can refuse the login rather than routing around
 * a zeroed id.
 */
export function fromWire(raw: WireSession): Session {
  if (!raw || typeof raw.sub !== 'string') {
    throw new Error('invalid session wire payload');
  }
  const idx = raw.sub.indexOf(':');
  if (idx <= 0) throw new Error(`invalid session sub: ${raw.sub}`);
  const numeric = Number(raw.sub.slice(idx + 1));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`invalid session sub (non-numeric id): ${raw.sub}`);
  }
  return {
    id: numeric,
    type: raw.type,
    email: raw.email,
    name: raw.name,
    scopes: raw.scopes ?? [],
  };
}

export const hasScope = (session: Session | null | undefined, scope: string): boolean =>
  !!session?.scopes?.includes(scope);

export const hasAnyScope = (session: Session | null | undefined, scopes: string[]): boolean =>
  !!scopes.some((s) => session?.scopes?.includes(s));

export const hasAllScopes = (session: Session | null | undefined, scopes: string[]): boolean =>
  !!scopes.every((s) => session?.scopes?.includes(s));

export const fetchSession = async (): Promise<Session> => {
  const raw = await apiFetch<WireSession>('/api/v1/auth/session');
  return fromWire(raw);
};

export const loginAdmin = (
  email: string,
  password: string,
  totpCode?: string,
): Promise<{ admin: { id: number; email: string; name: string } }> =>
  apiFetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, totpCode, type: 'admin' }),
  });

export type AuthenticatedUser = {
  id: number;
  email: string;
  name: string;
  role: string;
  scopes?: string[];
};

export type LoginResponse = { requires2fa: true } | { user: AuthenticatedUser };

export const loginUser = (
  email: string,
  password: string,
  totpCode?: string,
): Promise<LoginResponse> =>
  apiFetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, totpCode, type: 'user' }),
  });

export const logout = (): Promise<void> => apiFetch('/api/v1/auth/logout', { method: 'POST' });

/**
 * Register a new user. OWASP V3.1.1 — the BFF always responds 202 with an
 * identical envelope regardless of whether the email / username was taken.
 * The user is NOT authenticated on success; they must click the emailed
 * verification link to finish.
 */
export const registerUser = (
  email: string,
  username: string,
  password: string,
): Promise<{ ok: true; message: string }> =>
  apiFetch('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, username, password }),
  });

/**
 * Exchange a verification token from the emailed link for a live session.
 * BFF sets session + refresh cookies on success, identical to login.
 */
export const verifyEmail = (
  token: string,
): Promise<{ user: AuthenticatedUser }> =>
  apiFetch('/api/v1/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });

/**
 * Ask BFF to send a password-reset email. Always resolves (204) regardless of
 * whether the email exists — do not leak account enumeration info to caller.
 */
export const requestPasswordReset = (email: string): Promise<void> =>
  apiFetch('/api/v1/auth/password-reset/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

/**
 * Finalize a password reset using the token from the email link.
 */
export const confirmPasswordReset = (token: string, newPassword: string): Promise<void> =>
  apiFetch('/api/v1/auth/password-reset/confirm', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });

/**
 * Change password of the currently signed-in user. Requires a valid session
 * (BFF's SessionGuard enforces this).
 */
export const changePassword = (
  currentPassword: string,
  newPassword: string,
): Promise<void> =>
  apiFetch('/api/v1/auth/password-change', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });

/**
 * Delete the current user's account. BFF clears session cookies on success.
 */
export const deleteAccount = (): Promise<void> =>
  apiFetch('/api/v1/auth/account', { method: 'DELETE' });
