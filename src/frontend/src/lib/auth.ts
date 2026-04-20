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

export const fetchSession = (): Promise<Session> =>
  apiFetch('/api/v1/auth/session');

export const loginAdmin = (email: string, password: string, totpCode?: string): Promise<{ admin: { id: number; email: string; name: string } }> =>
  apiFetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, totpCode, type: 'admin' }),
  });

export const loginUser = (email: string, password: string, totpCode?: string): Promise<{ user: { id: number; email: string; name: string; role: string } }> =>
  apiFetch('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, totpCode, type: 'user' }),
  });

export const logout = (): Promise<void> =>
  apiFetch('/api/v1/auth/logout', { method: 'POST' });
