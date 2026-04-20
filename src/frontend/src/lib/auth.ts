import { apiFetch } from './api-client';

export interface Session {
  adminId?: number;
  userId?: number;
  email: string;
  type: 'admin' | 'user';
}

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
