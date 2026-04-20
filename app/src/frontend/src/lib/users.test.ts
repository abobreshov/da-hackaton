import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { blockUser, unblockUser, reportUser } from './users';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('lib/users', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    // CSRF cookie so attachCsrfHeader is satisfied for mutating calls.
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'csrf=tok',
      set: () => {},
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blockUser() POSTs /api/v1/users/:id/ban', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await blockUser(42);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/users\/42\/ban$/);
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('unblockUser() DELETEs /api/v1/users/:id/ban', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await unblockUser(42);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/users\/42\/ban$/);
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('reportUser() POSTs /api/v1/reports with target payload', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 7 }, 201));
    await reportUser({ targetType: 'user', targetId: 99, reason: 'spam' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/reports$/);
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      targetType: 'user',
      targetId: 99,
      reason: 'spam',
    });
  });

  it('surfaces ApiError on non-2xx block', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'FORBIDDEN', message: 'cannot block self' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(blockUser(1)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });
});
