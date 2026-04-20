import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const onMock = vi.fn();
const offMock = vi.fn();

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({
    on: onMock,
    off: offMock,
    emit: vi.fn(),
  }),
  disconnect: vi.fn(),
}));

import { usePresenceMap, presenceMapStore } from './usePresenceMap';

const fireServerEvent = (payload: unknown) => {
  // Pick the latest registered listener for `presence.update`.
  const call = [...onMock.mock.calls].reverse().find((c) => c[0] === 'presence.update');
  const listener = call?.[1] as ((p: unknown) => void) | undefined;
  if (!listener) throw new Error('no presence.update listener registered');
  listener(payload);
};

describe('usePresenceMap', () => {
  beforeEach(() => {
    onMock.mockClear();
    offMock.mockClear();
    // Reset the underlying store so tests are isolated.
    presenceMapStore.getState().reset();
  });
  afterEach(() => {
    presenceMapStore.getState().reset();
  });

  it('subscribes to presence.update on mount and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => usePresenceMap());
    expect(onMock).toHaveBeenCalledWith('presence.update', expect.any(Function));
    unmount();
    expect(offMock).toHaveBeenCalledWith('presence.update', expect.any(Function));
  });

  it('starts with an empty map', () => {
    const { result } = renderHook(() => usePresenceMap());
    expect(result.current.size).toBe(0);
  });

  it('applies a single-delta update (flat shape)', () => {
    const { result } = renderHook(() => usePresenceMap());
    act(() => {
      fireServerEvent({ userId: 42, status: 'online' });
    });
    expect(result.current.get(42)).toBe('online');
  });

  it('applies a coalesced batch update ({ deltas: [...] })', () => {
    const { result } = renderHook(() => usePresenceMap());
    act(() => {
      fireServerEvent({
        deltas: [
          { userId: 1, status: 'online' },
          { userId: 2, status: 'afk' },
          { userId: 3, status: 'offline' },
        ],
      });
    });
    expect(result.current.get(1)).toBe('online');
    expect(result.current.get(2)).toBe('afk');
    expect(result.current.get(3)).toBe('offline');
    expect(result.current.size).toBe(3);
  });

  it('overwrites an existing entry when the same userId receives a new status', () => {
    const { result } = renderHook(() => usePresenceMap());
    act(() => {
      fireServerEvent({ userId: 7, status: 'online' });
    });
    expect(result.current.get(7)).toBe('online');
    act(() => {
      fireServerEvent({ userId: 7, status: 'afk' });
    });
    expect(result.current.get(7)).toBe('afk');
  });

  it('ignores malformed payloads (no userId/status)', () => {
    const { result } = renderHook(() => usePresenceMap());
    act(() => {
      fireServerEvent(null);
      fireServerEvent({});
      fireServerEvent({ userId: 'nope' });
      fireServerEvent({ deltas: 'not-an-array' });
    });
    expect(result.current.size).toBe(0);
  });

  it('is shared across hook instances (same store)', () => {
    const a = renderHook(() => usePresenceMap());
    const b = renderHook(() => usePresenceMap());
    act(() => {
      fireServerEvent({ userId: 99, status: 'online' });
    });
    expect(a.result.current.get(99)).toBe('online');
    expect(b.result.current.get(99)).toBe('online');
  });
});
