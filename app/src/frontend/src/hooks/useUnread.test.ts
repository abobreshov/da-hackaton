import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const onMock = vi.fn();
const offMock = vi.fn();

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: onMock, off: offMock, emit: vi.fn() }),
  disconnect: vi.fn(),
}));

const getUnreadCountsMock = vi.fn();
vi.mock('@/lib/unread', async () => {
  const actual = await vi.importActual<typeof import('@/lib/unread')>('@/lib/unread');
  return {
    ...actual,
    getUnreadCounts: (...args: unknown[]) => getUnreadCountsMock(...args),
  };
});

import { unreadStore, useUnread, UNREAD_BADGE_CAP } from './useUnread';

const fireServerEvent = (payload: unknown) => {
  const call = [...onMock.mock.calls].reverse().find((c) => c[0] === 'unread.changed');
  const listener = call?.[1] as ((p: unknown) => void) | undefined;
  if (!listener) throw new Error('no unread.changed listener registered');
  listener(payload);
};

describe('useUnread', () => {
  beforeEach(() => {
    onMock.mockClear();
    offMock.mockClear();
    getUnreadCountsMock.mockReset();
    unreadStore.getState().reset();
  });
  afterEach(() => {
    unreadStore.getState().reset();
  });

  it('subscribes to unread.changed on mount and unsubscribes on unmount', () => {
    getUnreadCountsMock.mockResolvedValue({ rooms: [], dms: [] });
    const { unmount } = renderHook(() => useUnread());
    expect(onMock).toHaveBeenCalledWith('unread.changed', expect.any(Function));
    unmount();
    expect(offMock).toHaveBeenCalledWith('unread.changed', expect.any(Function));
  });

  it('hydrates from GET /unread on first mount', async () => {
    getUnreadCountsMock.mockResolvedValue({
      rooms: [
        { roomId: 1, count: 5 },
        { roomId: 2, count: 0 },
      ],
      dms: [{ dmId: 10, peerUserId: 42, count: 3 }],
    });
    const { result } = renderHook(() => useUnread());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.rooms.get(1)).toBe(5);
    expect(result.current.rooms.get(2)).toBe(0);
    expect(result.current.dms.get(42)).toBe(3);
  });

  it('does not re-fetch on subsequent mounts once hydrated', async () => {
    getUnreadCountsMock.mockResolvedValue({ rooms: [], dms: [] });
    const { unmount } = renderHook(() => useUnread());
    await waitFor(() => expect(unreadStore.getState().hydrated).toBe(true));
    unmount();
    getUnreadCountsMock.mockClear();
    renderHook(() => useUnread());
    expect(getUnreadCountsMock).not.toHaveBeenCalled();
  });

  it('applies a room-scope unread.changed delta', async () => {
    getUnreadCountsMock.mockResolvedValue({ rooms: [], dms: [] });
    const { result } = renderHook(() => useUnread());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => {
      fireServerEvent({
        event: 'unread.changed',
        scope: { roomId: 7 },
        count: 4,
      });
    });
    expect(result.current.rooms.get(7)).toBe(4);
  });

  it('applies a dm-scope unread.changed delta keyed by peerUserId', async () => {
    getUnreadCountsMock.mockResolvedValue({ rooms: [], dms: [] });
    const { result } = renderHook(() => useUnread());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => {
      fireServerEvent({
        event: 'unread.changed',
        scope: { dmId: 3, peerUserId: 77 },
        count: 9,
      });
    });
    expect(result.current.dms.get(77)).toBe(9);
  });

  it('clamps counts at the 99 UI cap', async () => {
    getUnreadCountsMock.mockResolvedValue({
      rooms: [{ roomId: 1, count: 9999 }],
      dms: [],
    });
    const { result } = renderHook(() => useUnread());
    await waitFor(() => expect(result.current.rooms.get(1)).toBe(UNREAD_BADGE_CAP));
  });

  it('drops malformed payloads without updating state', async () => {
    getUnreadCountsMock.mockResolvedValue({
      rooms: [{ roomId: 1, count: 2 }],
      dms: [],
    });
    const { result } = renderHook(() => useUnread());
    await waitFor(() => expect(result.current.rooms.get(1)).toBe(2));

    act(() => {
      fireServerEvent(null);
      fireServerEvent({ count: 10 });
      fireServerEvent({ scope: { bogus: true }, count: 10 });
      fireServerEvent({ scope: { roomId: 1 } });
    });
    expect(result.current.rooms.get(1)).toBe(2);
  });

  it('hydrate failure leaves store empty but does not throw', async () => {
    getUnreadCountsMock.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useUnread());
    // tick microtasks
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.hydrated).toBe(false);
    expect(result.current.rooms.size).toBe(0);
    expect(result.current.dms.size).toBe(0);
  });
});
