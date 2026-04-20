import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  promoteMember,
  demoteMember,
  removeMember,
  unbanMember,
  listRoomBans,
  deleteRoom,
  updateRoom,
  inviteUser,
} from './moderation';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('lib/moderation', () => {
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

  it('promoteMember() POSTs /api/v1/rooms/:id/members/:userId/promote', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await promoteMember(7, 42);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/rooms\/7\/members\/42\/promote$/);
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('demoteMember() POSTs /api/v1/rooms/:id/members/:userId/demote', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await demoteMember(7, 42);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/rooms\/7\/members\/42\/demote$/);
    expect((init as RequestInit).method).toBe('POST');
  });

  it('removeMember() DELETEs /api/v1/rooms/:id/members/:userId (= ban)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await removeMember(7, 42);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/rooms\/7\/members\/42$/);
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('unbanMember() POSTs /api/v1/rooms/:id/bans/:userId/unban', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await unbanMember(7, 42);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/rooms\/7\/bans\/42\/unban$/);
    expect((init as RequestInit).method).toBe('POST');
  });

  it('listRoomBans() GETs /api/v1/rooms/:id/bans and returns parsed payload', async () => {
    const payload = {
      bans: [
        {
          userId: 42,
          username: 'spammer',
          bannedBy: 1,
          bannedByUsername: 'owner',
          createdAt: '2026-04-20T10:00:00Z',
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload));
    const res = await listRoomBans(7);
    expect(res).toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/rooms\/7\/bans$/);
    expect((init as RequestInit).method).toBe('GET');
  });

  it('deleteRoom() DELETEs /api/v1/rooms/:id', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteRoom(7);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/rooms\/7$/);
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('updateRoom() PATCHes /api/v1/rooms/:id with the given patch body', async () => {
    const patch = {
      name: 'new-name',
      description: 'new desc',
      visibility: 'public' as const,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 7, ...patch, memberCount: 1 }));
    await updateRoom(7, patch);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/rooms\/7$/);
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(patch);
  });

  it('inviteUser() POSTs /api/v1/rooms/:id/invitations with { username }', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 101 }, 201));
    await inviteUser(7, 'alice');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/rooms\/7\/invitations$/);
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      username: 'alice',
    });
  });

  it('surfaces ApiError on non-2xx responses', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'FORBIDDEN', message: 'not owner' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(deleteRoom(7)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: 'not owner',
    });
  });
});
