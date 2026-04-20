import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listFriends,
  sendFriendRequest,
  acceptRequest,
  rejectRequest,
  removeFriend,
} from './friends';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('lib/friends', () => {
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

  it('listFriends() GETs /api/v1/friends and returns parsed payload', async () => {
    const payload = {
      friends: [{ userId: 1, username: 'alice' }],
      incoming: [{ id: 11, from: { userId: 2, username: 'bob' } }],
      outgoing: [{ id: 12, to: { userId: 3, username: 'chris' } }],
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload));
    const res = await listFriends();
    expect(res).toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/friends$/);
    expect((init as RequestInit).method).toBe('GET');
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('sendFriendRequest() POSTs /api/v1/friends/requests with { username }', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 99 }, 201));
    await sendFriendRequest('alice');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/friends\/requests$/);
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ username: 'alice' });
  });

  it('acceptRequest() POSTs /api/v1/friends/requests/:id/accept', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await acceptRequest(55);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/friends\/requests\/55\/accept$/);
    expect((init as RequestInit).method).toBe('POST');
  });

  it('rejectRequest() POSTs /api/v1/friends/requests/:id/reject', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await rejectRequest(77);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/friends\/requests\/77\/reject$/);
    expect((init as RequestInit).method).toBe('POST');
  });

  it('removeFriend() DELETEs /api/v1/friends/:userId', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await removeFriend(12);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/friends\/12$/);
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('surfaces ApiError on non-2xx responses', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'NOT_FOUND', message: 'no such user' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(sendFriendRequest('ghost')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'no such user',
    });
  });
});
