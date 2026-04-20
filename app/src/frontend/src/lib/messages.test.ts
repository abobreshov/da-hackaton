import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listRoomMessages,
  listDmMessages,
  getMessageById,
  sendMessageHttp,
  editMessageHttp,
  deleteMessageHttp,
  normaliseMessage,
} from './messages';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('lib/messages', () => {
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

  it('normaliseMessage parses bigint fields and tolerates snake_case timestamps', () => {
    const m = normaliseMessage({
      id: '1000000000000001',
      room_id: 42,
      author: { id: 7, username: 'alice' },
      body: 'hi',
      reply_to: '1000000000000000',
      edited_at: null,
      deleted_at: null,
      created_at: '2026-04-20T10:00:00.000Z',
    });
    expect(m.id).toBe(1000000000000001n);
    expect(m.replyTo).toBe(1000000000000000n);
    expect(m.roomId).toBe(42);
    expect(m.dmId).toBeNull();
    expect(m.author).toEqual({ id: 7, username: 'alice' });
    expect(m.createdAt).toBe('2026-04-20T10:00:00.000Z');
  });

  it('listRoomMessages() GETs /api/v1/rooms/:id/messages and parses cursor', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        messages: [
          {
            id: '1',
            roomId: 42,
            author: { id: 1, username: 'a' },
            body: 'hi',
            createdAt: '2026-04-20T10:00:00.000Z',
          },
        ],
        nextCursor: { createdAt: '2026-04-20T09:00:00.000Z', id: '0' },
      }),
    );
    const res = await listRoomMessages(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/rooms\/42\/messages$/);
    expect((init as RequestInit).method).toBe('GET');
    expect(res.messages[0].id).toBe(1n);
    expect(res.nextCursor).toEqual({
      createdAt: '2026-04-20T09:00:00.000Z',
      id: 0n,
    });
  });

  it('listRoomMessages() encodes cursor as before + beforeId query params', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ messages: [], nextCursor: null }),
    );
    await listRoomMessages(42, {
      createdAt: '2026-04-19T00:00:00.000Z',
      id: 100n,
    });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toMatch(/before=2026-04-19T00%3A00%3A00.000Z/);
    expect(url).toMatch(/beforeId=100/);
  });

  it('listDmMessages() GETs /api/v1/dms/:userId/messages', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ messages: [], nextCursor: null }),
    );
    await listDmMessages(7);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/dms\/7\/messages$/);
  });

  it('getMessageById() GETs /api/v1/messages/:id and unwraps { message }', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        message: {
          id: '9',
          roomId: 1,
          author: { id: 2, username: 'b' },
          body: 'x',
          createdAt: '2026-04-20T10:00:00.000Z',
        },
      }),
    );
    const m = await getMessageById(9n);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/messages\/9$/);
    expect(m.id).toBe(9n);
    expect(m.body).toBe('x');
  });

  it('sendMessageHttp() POSTs /api/v1/messages with stringified replyToId', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: '10',
        roomId: 42,
        author: { id: 1, username: 'a' },
        body: 'hi',
        createdAt: '2026-04-20T10:00:00.000Z',
      }, 201),
    );
    await sendMessageHttp({ roomId: 42, body: 'hi', replyToId: 9n });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/messages$/);
    expect((init as RequestInit).method).toBe('POST');
    const parsed = JSON.parse((init as RequestInit).body as string);
    expect(parsed).toEqual({ roomId: 42, body: 'hi', replyToId: '9' });
  });

  it('editMessageHttp() PATCHes /api/v1/messages/:id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        message: {
          id: '10',
          roomId: 42,
          author: { id: 1, username: 'a' },
          body: 'new',
          editedAt: '2026-04-20T10:05:00.000Z',
          createdAt: '2026-04-20T10:00:00.000Z',
        },
      }),
    );
    const m = await editMessageHttp(10n, { body: 'new' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/messages\/10$/);
    expect((init as RequestInit).method).toBe('PATCH');
    expect(m.editedAt).toBe('2026-04-20T10:05:00.000Z');
  });

  it('deleteMessageHttp() DELETEs /api/v1/messages/:id', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteMessageHttp(10n);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/messages\/10$/);
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('surfaces ApiError on non-2xx responses', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'DM_FROZEN', message: 'frozen' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(sendMessageHttp({ dmUserId: 5, body: 'hi' })).rejects.toMatchObject({
      status: 403,
      code: 'DM_FROZEN',
    });
  });
});
