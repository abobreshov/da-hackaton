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

import { useMessagesSync } from './useMessagesSync';
import { resetMessagesStores, getMessagesStore } from './useMessagesStore';

const fireServerEvent = (event: string, payload: unknown): void => {
  const call = [...onMock.mock.calls].reverse().find((c) => c[0] === event);
  const listener = call?.[1] as ((p: unknown) => void) | undefined;
  if (!listener) throw new Error(`no ${event} listener registered`);
  listener(payload);
};

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

const wireMessage = (id: bigint, body: string, createdAt: string) => ({
  id: id.toString(),
  roomId: 42,
  authorId: 1,
  authorUsername: 'alice',
  body,
  createdAt,
});

describe('useMessagesSync (hydrate + WS subscribe + loadOlder)', () => {
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

  it('fetches initial room history on mount and seeds the store', async () => {
    listRoomMessagesMock.mockResolvedValue({
      messages: [seedMessage(1n, 'hello', '2026-04-20T10:00:00.000Z')],
      nextCursor: { createdAt: '2026-04-20T10:00:00.000Z', id: 1n },
    });
    const { result } = renderHook(() => useMessagesSync({ roomId: 42 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listRoomMessagesMock).toHaveBeenCalledWith(42);
    expect(result.current.hasMore).toBe(true);
    const s = getMessagesStore({ roomId: 42 }).getState();
    expect(s.order).toEqual([1n]);
  });

  it('uses listDmMessages when dmUserId is provided', async () => {
    listDmMessagesMock.mockResolvedValue({ messages: [], nextCursor: null });
    const { result } = renderHook(() => useMessagesSync({ dmUserId: 7 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listDmMessagesMock).toHaveBeenCalledWith(7);
    expect(listRoomMessagesMock).not.toHaveBeenCalled();
  });

  it('subscribes + unsubscribes to message.new|edited|deleted across mount/unmount', () => {
    listRoomMessagesMock.mockResolvedValue({ messages: [], nextCursor: null });
    const { unmount } = renderHook(() => useMessagesSync({ roomId: 42 }));
    expect(onMock).toHaveBeenCalledWith('message.new', expect.any(Function));
    expect(onMock).toHaveBeenCalledWith('message.edited', expect.any(Function));
    expect(onMock).toHaveBeenCalledWith('message.deleted', expect.any(Function));
    unmount();
    expect(offMock).toHaveBeenCalledWith('message.new', expect.any(Function));
    expect(offMock).toHaveBeenCalledWith('message.edited', expect.any(Function));
    expect(offMock).toHaveBeenCalledWith('message.deleted', expect.any(Function));
  });

  it('applies a message.new event to the store', async () => {
    listRoomMessagesMock.mockResolvedValue({ messages: [], nextCursor: null });
    const { result } = renderHook(() => useMessagesSync({ roomId: 42 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      fireServerEvent('message.new', wireMessage(10n, 'live', '2026-04-20T10:05:00.000Z'));
    });
    const s = getMessagesStore({ roomId: 42 }).getState();
    expect(s.order).toEqual([10n]);
    expect(s.byId.get(10n)?.body).toBe('live');
  });

  it('drops message.new with mismatched roomId (wrong conversation)', async () => {
    listRoomMessagesMock.mockResolvedValue({ messages: [], nextCursor: null });
    const { result } = renderHook(() => useMessagesSync({ roomId: 42 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      fireServerEvent('message.new', {
        ...wireMessage(99n, 'other', '2026-04-20T10:05:00.000Z'),
        roomId: 999,
      });
    });
    expect(getMessagesStore({ roomId: 42 }).getState().order).toEqual([]);
  });

  it('applies message.edited and message.deleted (tombstone) events', async () => {
    listRoomMessagesMock.mockResolvedValue({
      messages: [seedMessage(5n, 'orig', '2026-04-20T10:00:00.000Z')],
      nextCursor: null,
    });
    const { result } = renderHook(() => useMessagesSync({ roomId: 42 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      fireServerEvent('message.edited', {
        id: '5',
        body: 'edited!',
        editedAt: '2026-04-20T10:05:00.000Z',
        roomId: 42,
      });
    });
    expect(getMessagesStore({ roomId: 42 }).getState().byId.get(5n)?.body).toBe('edited!');
    act(() => {
      fireServerEvent('message.deleted', {
        id: '5',
        deletedAt: '2026-04-20T10:06:00.000Z',
        roomId: 42,
      });
    });
    expect(getMessagesStore({ roomId: 42 }).getState().byId.get(5n)?.deletedAt).toBe(
      '2026-04-20T10:06:00.000Z',
    );
  });

  it('loadOlder() prepends older page using the oldest cursor', async () => {
    listRoomMessagesMock
      .mockResolvedValueOnce({
        messages: [seedMessage(10n, 'newest', '2026-04-20T10:10:00.000Z')],
        nextCursor: { createdAt: '2026-04-20T10:10:00.000Z', id: 10n },
      })
      .mockResolvedValueOnce({
        messages: [seedMessage(5n, 'older', '2026-04-20T09:00:00.000Z')],
        nextCursor: null,
      });
    const { result } = renderHook(() => useMessagesSync({ roomId: 42 }));
    await waitFor(() => expect(getMessagesStore({ roomId: 42 }).getState().order.length).toBe(1));
    await act(async () => {
      await result.current.loadOlder();
    });
    expect(listRoomMessagesMock).toHaveBeenCalledTimes(2);
    expect(listRoomMessagesMock.mock.calls[1][1]).toEqual({
      createdAt: '2026-04-20T10:10:00.000Z',
      id: 10n,
    });
    expect(getMessagesStore({ roomId: 42 }).getState().order).toEqual([5n, 10n]);
    expect(result.current.hasMore).toBe(false);
  });

  it('loadOlder() is a no-op when hasMore is false', async () => {
    listRoomMessagesMock.mockResolvedValue({ messages: [], nextCursor: null });
    const { result } = renderHook(() => useMessagesSync({ roomId: 42 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.loadOlder();
    });
    expect(listRoomMessagesMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces fetch errors via the error field', async () => {
    listRoomMessagesMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useMessagesSync({ roomId: 42 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('boom');
  });
});
