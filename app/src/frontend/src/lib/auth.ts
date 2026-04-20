import { apiFetch } from './api-client';

export interface Session {
  adminId?: number;
  userId?: number;
  email: string;
  name: string;
  type: 'admin' | 'user';
  scopes: string[];
}

export const hasScope = (session: Session | null | undefined, scope: string): boolean =>
  !!session?.scopes?.includes(scope);

export const hasAnyScope = (session: Session | null | undefined, scopes: string[]): boolean =>
  !!scopes.some((s) => session?.scopes?.includes(s));

export const hasAllScopes = (session: Session | null | undefined, scopes: string[]): boolean =>
  !!scopes.every((s) => session?.scopes?.includes(s));

export const fetchSession = (): Promise<Session> => apiFetch('/api/v1/auth/session');

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
 * Register a new user. BFF sets session + CSRF cookies on success and returns
 * the user payload — identical in shape to a successful loginUser response.
 */
export const registerUser = (
  email: string,
  username: string,
  password: string,
): Promise<{ user: AuthenticatedUser }> =>
  apiFetch('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, username, password }),
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
