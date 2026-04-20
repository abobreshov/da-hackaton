import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getUnreadCounts, markRoomRead, markDmRead } from './unread';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const noContent = () => new Response(null, { status: 204 });

describe('lib/unread', () => {
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

  it('getUnreadCounts() GETs /api/v1/unread and returns the parsed shape', async () => {
    const payload = {
      rooms: [{ roomId: 1, count: 5 }],
      dms: [{ dmId: 10, peerUserId: 42, count: 3 }],
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload));
    const res = await getUnreadCounts();
    expect(res).toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/unread$/);
    expect((init as RequestInit).method).toBe('GET');
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('markRoomRead() POSTs /api/v1/rooms/:id/read with { lastReadId } string body', async () => {
    fetchMock.mockResolvedValueOnce(noContent());
    await markRoomRead(7, '123');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/rooms\/7\/read$/);
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe(JSON.stringify({ lastReadId: '123' }));
  });

  it('markDmRead() POSTs /api/v1/dms/:userId/read with { lastReadId } string body', async () => {
    fetchMock.mockResolvedValueOnce(noContent());
    await markDmRead(42, '456');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/dms\/42\/read$/);
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe(JSON.stringify({ lastReadId: '456' }));
  });
});
