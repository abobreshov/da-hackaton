import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Session } from './auth';
import {
  hasScope,
  hasAnyScope,
  hasAllScopes,
  loginAdmin,
  loginUser,
  logout,
  fetchSession,
  registerUser,
  requestPasswordReset,
  confirmPasswordReset,
  changePassword,
  deleteAccount,
} from './auth';

const session = (scopes: string[] | undefined): Session | null =>
  ({ email: 'u@x', name: 'U', type: 'user', scopes: scopes as string[] }) as Session;

describe('auth scope helpers', () => {
  it('hasScope — true when scope present', () => {
    expect(hasScope(session(['rooms:read']), 'rooms:read')).toBe(true);
  });

  it('hasScope — false when scope missing', () => {
    expect(hasScope(session(['rooms:read']), 'rooms:write')).toBe(false);
  });

  it('hasScope — false on null/undefined session or scopes', () => {
    expect(hasScope(null, 'x')).toBe(false);
    expect(hasScope(undefined, 'x')).toBe(false);
    expect(hasScope(session(undefined), 'x')).toBe(false);
  });

  it('hasAnyScope — true when at least one matches', () => {
    expect(hasAnyScope(session(['a']), ['a', 'b'])).toBe(true);
    expect(hasAnyScope(session(['b']), ['a', 'b'])).toBe(true);
  });

  it('hasAnyScope — false when none match', () => {
    expect(hasAnyScope(session(['c']), ['a', 'b'])).toBe(false);
    expect(hasAnyScope(null, ['a'])).toBe(false);
  });

  it('hasAllScopes — true only when every scope matches', () => {
    expect(hasAllScopes(session(['a', 'b', 'c']), ['a', 'b'])).toBe(true);
    expect(hasAllScopes(session(['a']), ['a', 'b'])).toBe(false);
  });

  it('hasAllScopes — vacuously true for empty required list', () => {
    expect(hasAllScopes(session([]), [])).toBe(true);
  });
});

describe('auth API wrappers', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const jsonOk = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const empty = (status = 204) => new Response(null, { status });

  // URLs are prefixed with VITE_BFF_URL when the env var is set (dev-local
   // setup), and bare when unset (Docker stack proxies /api via nginx). Accept
   // both by matching the suffix.
   const urlEndsWith = (url: unknown, suffix: string) => {
    expect(typeof url).toBe('string');
    expect(url as string).toMatch(new RegExp(`${suffix.replace(/[/]/g, '\\/')}$`));
  };

  it('registerUser — POSTs email/username/password and returns user', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ user: { id: 1, email: 'a@b.co', name: 'ab', role: 'user' } }, 201),
    );
    const res = await registerUser('a@b.co', 'ab', 'SecretPW1!');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    urlEndsWith(url, '/api/v1/auth/register');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      email: 'a@b.co',
      username: 'ab',
      password: 'SecretPW1!',
    });
    expect(res.user.email).toBe('a@b.co');
  });

  it('requestPasswordReset — POSTs email, resolves on 204', async () => {
    fetchMock.mockResolvedValueOnce(empty(204));
    await expect(requestPasswordReset('a@b.co')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    urlEndsWith(url, '/api/v1/auth/password-reset/request');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.co' });
  });

  it('confirmPasswordReset — POSTs token + newPassword, resolves on 204', async () => {
    fetchMock.mockResolvedValueOnce(empty(204));
    await expect(confirmPasswordReset('tok_0123456789abcdef', 'NewPW1234!')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    urlEndsWith(url, '/api/v1/auth/password-reset/confirm');
    expect(JSON.parse(init.body)).toEqual({
      token: 'tok_0123456789abcdef',
      newPassword: 'NewPW1234!',
    });
  });

  it('changePassword — POSTs current + new, resolves on 204', async () => {
    fetchMock.mockResolvedValueOnce(empty(204));
    await expect(changePassword('OldPW1234!', 'NewPW1234!')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    urlEndsWith(url, '/api/v1/auth/password-change');
    expect(JSON.parse(init.body)).toEqual({
      currentPassword: 'OldPW1234!',
      newPassword: 'NewPW1234!',
    });
  });

  it('deleteAccount — DELETEs /auth/account, resolves on 204', async () => {
    fetchMock.mockResolvedValueOnce(empty(204));
    await expect(deleteAccount()).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    urlEndsWith(url, '/api/v1/auth/account');
    expect(init.method).toBe('DELETE');
  });

  it('fetchSession — GETs /auth/session and returns body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ email: 'a@b.co', name: 'A', type: 'user', scopes: [] }),
    );
    const res = await fetchSession();
    expect(res.email).toBe('a@b.co');
    const [url, init] = fetchMock.mock.calls[0];
    urlEndsWith(url, '/api/v1/auth/session');
    // fetchSession does not pass init.method explicitly — apiFetch defaults to GET.
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('loginUser — POSTs email/password/totpCode/type=user', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ user: { id: 1, email: 'u@x', name: 'u', role: 'user' } }),
    );
    const res = await loginUser('u@x', 'Secret123!', '123456');
    expect('user' in res && res.user.email).toBe('u@x');
    const [url, init] = fetchMock.mock.calls[0];
    urlEndsWith(url, '/api/v1/auth/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      email: 'u@x',
      password: 'Secret123!',
      totpCode: '123456',
      type: 'user',
    });
  });

  it('loginUser — relays { requires2fa: true } response shape', async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ requires2fa: true }));
    const res = await loginUser('u2@x', 'Secret123!');
    expect(res).toEqual({ requires2fa: true });
  });

  it('loginAdmin — POSTs with type=admin and returns admin payload', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ admin: { id: 9, email: 'root@x', name: 'root' } }),
    );
    const res = await loginAdmin('root@x', 'AdminPW1!', '000111');
    expect(res.admin.email).toBe('root@x');
    const [url, init] = fetchMock.mock.calls[0];
    urlEndsWith(url, '/api/v1/auth/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      email: 'root@x',
      password: 'AdminPW1!',
      totpCode: '000111',
      type: 'admin',
    });
  });

  it('loginAdmin — omits totpCode when not provided', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ admin: { id: 9, email: 'root@x', name: 'root' } }),
    );
    await loginAdmin('root@x', 'AdminPW1!');
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.type).toBe('admin');
    expect(body.totpCode).toBeUndefined();
  });

  it('logout — POSTs to /auth/logout, resolves on 204', async () => {
    fetchMock.mockResolvedValueOnce(empty(204));
    await expect(logout()).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    urlEndsWith(url, '/api/v1/auth/logout');
    expect(init.method).toBe('POST');
  });
});
