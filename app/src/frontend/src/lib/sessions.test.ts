import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listSessions, revokeSession } from './sessions';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('lib/sessions', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'csrf=tok',
      set: () => {},
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listSessions() GETs /api/v1/sessions and returns parsed payload', async () => {
    const payload = {
      sessions: [
        {
          id: 'sess-1',
          userAgent: 'Mozilla/5.0',
          ip: '127.0.0.1',
          createdAt: '2026-04-20T10:00:00.000Z',
          lastSeenAt: '2026-04-20T11:00:00.000Z',
          current: true,
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload));
    const res = await listSessions();
    expect(res).toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/sessions$/);
    expect((init as RequestInit).method).toBe('GET');
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('revokeSession() DELETEs /api/v1/sessions/:id', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await revokeSession('sess-abc');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/sessions\/sess-abc$/);
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('revokeSession() URL-encodes the id segment', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await revokeSession('a/b c');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/sessions\/a%2Fb%20c$/);
  });

  it('surfaces ApiError on non-2xx responses', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'no such session' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(revokeSession('missing')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'no such session',
    });
  });
});
