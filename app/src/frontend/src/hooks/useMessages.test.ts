import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const emitMock = vi.fn();
const onMock = vi.fn();
const offMock = vi.fn();

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({
    emit: emitMock,
    on: onMock,
    off: offMock,
    connected: true,
  }),
  disconnect: vi.fn(),
}));

const listRoomMessagesMock = vi.fn();
const listDmMessagesMock = vi.fn();

vi.mock('@/lib/messages', async (original) => {
  const actual = await original<typeof import('@/lib/messages')>();
  return {
    ...actual,
    listRoomMessages: (...args: unknown[]) => listRoomMessagesMock(...args),
    listDmMessages: (...args: unknown[]) => listDmMessagesMock(...args),
  };
});

import { useMessages, resetMessagesStores, getMessagesStore } from './useMessages';

const fireServerEvent = (event: string, payload: unknown): void => {
  const call = [...onMock.mock.calls].reverse().find((c) => c[0] === event);
  const listener = call?.[1] as ((p: unknown) => void) | undefined;
  if (!listener) throw new Error(`no ${event} listener registered`);
  listener(payload);
};

const takeAck = (event: string): ((res: unknown) => void) => {
  const call = [...emitMock.mock.calls].reverse().find((c) => c[0] === event);
  if (!call) throw new Error(`no ${event} emit recorded`);
  const ack = call[call.length - 1] as (res: unknown) => void;
  if (typeof ack !== 'function') throw new Error(`no ack callback in ${event} emit`);
  return ack;
};

/** Mirrors the parsed shape that `listRoomMessages` / `listDmMessages` return. */
const seedMessage = (id: bigint, body: string, createdAt: string) => ({
  id,
  roomId: 42,
  dmId: null as number | null,
  author: { id: 1, username: 'alice' },
  body,
  replyTo: null as bigint | null,
  editedAt: null as string | null,
  deletedAt: null as string | null,
  createdAt,
});

/** Raw-wire shape used to simulate server-pushed WS events + ack bodies. */
const wireMessage = (id: bigint, body: string, createdAt: string) => ({
  id: id.toString(),
  roomId: 42,
  author: { id: 1, username: 'alice' },
  body,
  createdAt,
});

describe('useMessages', () => {
  beforeEach(() => {
    emitMock.mockClear();
    onMock.mockClear();
    offMock.mockClear();
    listRoomMessagesMock.mockReset();
    listDmMessagesMock.mockReset();
    resetMessagesStores();
  });
  afterEach(() => {
    resetMessagesStores();
  });

  it('fetches initial history via listRoomMessages on mount', async () => {
    listRoomMessagesMock.mockResolvedValue({
      messages: [],
      nextCursor: null,
    });
    const { result } = renderHook(() => useMessages({ roomId: 42 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listRoomMessagesMock).toHaveBeenCalledWith(42);
    expect(result.current.messages).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });

  it('populates the store with the initial page', async () => {
    listRoomMessagesMock.mockResolvedValue({
      messages: [
        seedMessage(1n, 'hello', '2026-04-20T10:00:00.000Z'),
        seedMessage(2n, 'world', '2026-04-20T10:01:00.000Z'),
      ],
      nextCursor: { createdAt: '2026-04-20T10:00:00.000Z', id: 1n },
    });
    const { result } = renderHook(() => useMessages({ roomId: 42 }));
    await waitFor(() => expect(result.current.messages.length).toBe(2));
    expect(result.current.messages[0].body).toBe('hello');
    expect(result.current.messages[1].body).toBe('world');
    expect(result.current.hasMore).toBe(true);
  });

  it('subscribes to message.new / edited / deleted and unsubscribes on unmount', () => {
    listRoomMessagesMock.mockResolvedValue({ messages: [], nextCursor: null });
    const { unmount } = renderHook(() => useMessages({ roomId: 42 }));
    expect(onMock).toHaveBeenCalledWith('message.new', expect.any(Function));
    expect(onMock).toHaveBeenCalledWith('message.edited', expect.any(Function));
    expect(onMock).toHaveBeenCalledWith('message.deleted', expect.any(Function));
    unmount();
    expect(offMock).toHaveBeenCalledWith('message.new', expect.any(Function));
    expect(offMock).toHaveBeenCalledWith('message.edited', expect.any(Function));
    expect(offMock).toHaveBeenCalledWith('message.deleted', expect.any(Function));
  });

  it('applies message.new events to the store', async () => {
    listRoomMessagesMock.mockResolvedValue({ messages: [], nextCursor: null });
    const { result } = renderHook(() => useMessages({ roomId: 42 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      fireServerEvent('message.new', wireMessage(10n, 'live', '2026-04-20T10:05:00.000Z'));
    });
    expect(result.current.messages.length).toBe(1);
    expect(result.current.messages[0].body).toBe('live');
  });

  it('applies message.edited to the store', async () => {
    listRoomMessagesMock.mockResolvedValue({
      messages: [seedMessage(5n, 'orig', '2026-04-20T10:00:00.000Z')],
      nextCursor: null,
    });
    const { result } = renderHook(() => useMessages({ roomId: 42 }));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    act(() => {
      fireServerEvent('message.edited', {
        id: '5',
        body: 'edited!',
        editedAt: '2026-04-20T10:05:00.000Z',
        roomId: 42,
      });
    });
    expect(result.current.messages[0].body).toBe('edited!');
    expect(result.current.messages[0].editedAt).toBe('2026-04-20T10:05:00.000Z');
  });

  it('applies message.deleted as a tombstone (preserves the row)', async () => {
    listRoomMessagesMock.mockResolvedValue({
      messages: [seedMessage(5n, 'orig', '2026-04-20T10:00:00.000Z')],
      nextCursor: null,
    });
    const { result } = renderHook(() => useMessages({ roomId: 42 }));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    act(() => {
      fireServerEvent('message.deleted', {
        id: '5',
        deletedAt: '2026-04-20T10:05:00.000Z',
        roomId: 42,
      });
    });
    expect(result.current.messages[0].deletedAt).toBe('2026-04-20T10:05:00.000Z');
  });

  it('sendMessage emits message.send over WS with the ack → upserts', async () => {
    listRoomMessagesMock.mockResolvedValue({ messages: [], nextCursor: null });
    const { result } = renderHook(() => useMessages({ roomId: 42 }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const promise = result.current.sendMessage({ body: 'hi there' });
    const call = emitMock.mock.calls.find((c) => c[0] === 'message.send');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ roomId: 42, body: 'hi there' });
    const ack = takeAck('message.send');
    act(() => {
      ack({ message: wireMessage(20n, 'hi there', '2026-04-20T10:10:00.000Z') });
    });
    const msg = await promise;
    expect(msg.id).toBe(20n);
    expect(result.current.messages.some((m) => m.id === 20n)).toBe(true);
  });

  it('sendMessage rejects when ack carries an error (e.g. DM_FROZEN)', async () => {
    listDmMessagesMock.mockResolvedValue({ messages: [], nextCursor: null });
    const { result } = renderHook(() => useMessages({ dmUserId: 7 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const promise = result.current.sendMessage({ body: 'hi' }).catch((e) => e);
    const ack = takeAck('message.send');
    act(() => {
      ack({ error: { code: 'DM_FROZEN', message: 'frozen' } });
    });
    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { code?: string }).code).toBe('DM_FROZEN');
  });

  it('editMessage emits message.edit with id + body', async () => {
    listRoomMessagesMock.mockResolvedValue({
      messages: [seedMessage(5n, 'orig', '2026-04-20T10:00:00.000Z')],
      nextCursor: null,
    });
    const { result } = renderHook(() => useMessages({ roomId: 42 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const promise = result.current.editMessage(5n, 'new body');
    const call = emitMock.mock.calls.find((c) => c[0] === 'message.edit');
    expect(call).toBeDefined();
    expect(call![1]).toEqual({ id: '5', body: 'new body' });
    const ack = takeAck('message.edit');
    act(() => ack({ ok: true }));
    await expect(promise).resolves.toBeUndefined();
  });

  it('deleteMessage emits message.delete', async () => {
    listRoomMessagesMock.mockResolvedValue({
      messages: [seedMessage(5n, 'orig', '2026-04-20T10:00:00.000Z')],
      nextCursor: null,
    });
    const { result } = renderHook(() => useMessages({ roomId: 42 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const promise = result.current.deleteMessage(5n);
    const call = emitMock.mock.calls.find((c) => c[0] === 'message.delete');
    expect(call).toBeDefined();
    expect(call![1]).toEqual({ id: '5' });
    const ack = takeAck('message.delete');
    act(() => ack({ ok: true }));
    await expect(promise).resolves.toBeUndefined();
  });

  it('loadOlder() prepends an older page using the oldest cursor', async () => {
    listRoomMessagesMock
      .mockResolvedValueOnce({
        messages: [seedMessage(10n, 'newest', '2026-04-20T10:10:00.000Z')],
        nextCursor: { createdAt: '2026-04-20T10:10:00.000Z', id: 10n },
      })
      .mockResolvedValueOnce({
        messages: [seedMessage(5n, 'older', '2026-04-20T09:00:00.000Z')],
        nextCursor: null,
      });
    const { result } = renderHook(() => useMessages({ roomId: 42 }));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    await act(async () => {
      await result.current.loadOlder();
    });
    expect(listRoomMessagesMock).toHaveBeenCalledTimes(2);
    expect(listRoomMessagesMock.mock.calls[1][1]).toEqual({
      createdAt: '2026-04-20T10:10:00.000Z',
      id: 10n,
    });
    expect(result.current.messages.length).toBe(2);
    expect(result.current.messages[0].id).toBe(5n); // older first
    expect(result.current.messages[1].id).toBe(10n);
    expect(result.current.hasMore).toBe(false);
  });

  it('loadOlder() is a no-op when hasMore is false', async () => {
    listRoomMessagesMock.mockResolvedValue({ messages: [], nextCursor: null });
    const { result } = renderHook(() => useMessages({ roomId: 42 }));
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    await act(async () => {
      await result.current.loadOlder();
    });
    expect(listRoomMessagesMock).toHaveBeenCalledTimes(1); // only initial fetch
  });

  it('uses a dedicated store per conversation', async () => {
    listRoomMessagesMock.mockResolvedValue({
      messages: [seedMessage(1n, 'room', '2026-04-20T10:00:00.000Z')],
      nextCursor: null,
    });
    listDmMessagesMock.mockResolvedValue({
      messages: [
        {
          id: 99n,
          roomId: null,
          dmId: 3,
          author: { id: 2, username: 'b' },
          body: 'dm',
          replyTo: null,
          editedAt: null,
          deletedAt: null,
          createdAt: '2026-04-20T10:00:00.000Z',
        },
      ],
      nextCursor: null,
    });
    const room = renderHook(() => useMessages({ roomId: 42 }));
    const dm = renderHook(() => useMessages({ dmUserId: 7 }));
    await waitFor(() => expect(room.result.current.messages.length).toBe(1));
    await waitFor(() => expect(dm.result.current.messages.length).toBe(1));
    expect(room.result.current.messages[0].body).toBe('room');
    expect(dm.result.current.messages[0].body).toBe('dm');
    // And the underlying stores must be distinct instances.
    const r = getMessagesStore({ roomId: 42 });
    const d = getMessagesStore({ dmUserId: 7 });
    expect(r).not.toBe(d);
  });

  it('hydrates attachmentsByMessageId from the initial history fetch', async () => {
    listRoomMessagesMock.mockResolvedValue({
      messages: [seedMessage(7n, 'with image', '2026-04-20T10:00:00.000Z')],
      nextCursor: null,
      attachmentsByMessageId: {
        '7': [
          {
            id: 'att-h1',
            filename: 'p.png',
            mime: 'image/png',
            sizeBytes: 1,
            isImage: true,
          },
        ],
      },
    });
    const { result } = renderHook(() => useMessages({ roomId: 42 }));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    expect(result.current.attachmentsOf(7n)).toEqual([
      expect.objectContaining({ id: 'att-h1', isImage: true }),
    ]);
  });

  it('hydrates attachmentsByMessageId from a loadOlder() page', async () => {
    listRoomMessagesMock
      .mockResolvedValueOnce({
        messages: [seedMessage(10n, 'newest', '2026-04-20T10:10:00.000Z')],
        nextCursor: { createdAt: '2026-04-20T10:10:00.000Z', id: 10n },
        attachmentsByMessageId: {},
      })
      .mockResolvedValueOnce({
        messages: [seedMessage(5n, 'older', '2026-04-20T09:00:00.000Z')],
        nextCursor: null,
        attachmentsByMessageId: {
          '5': [
            {
              id: 'att-old',
              filename: 'o.png',
              mime: 'image/png',
              sizeBytes: 2,
              isImage: true,
            },
          ],
        },
      });
    const { result } = renderHook(() => useMessages({ roomId: 42 }));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    await act(async () => {
      await result.current.loadOlder();
    });
    expect(result.current.attachmentsOf(5n)).toEqual([
      expect.objectContaining({ id: 'att-old' }),
    ]);
    expect(result.current.attachmentsOf(10n)).toEqual([]);
  });

  it('exposes fetch errors via the `error` field', async () => {
    listRoomMessagesMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useMessages({ roomId: 42 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('boom');
  });
});
