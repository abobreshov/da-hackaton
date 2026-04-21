import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const onMock = vi.fn();
const offMock = vi.fn();

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: onMock, off: offMock, emit: vi.fn() }),
  disconnect: vi.fn(),
}));

import { useSocketStatus, socketStatusStore } from './useSocketStatus';
import { useSession } from './useSession';

const fire = (event: string, payload?: unknown) => {
  const calls = onMock.mock.calls.filter((c) => c[0] === event);
  if (calls.length === 0) throw new Error(`no listener registered for ${event}`);
  for (const call of calls) {
    const listener = call[1] as (p?: unknown) => void;
    listener(payload);
  }
};

describe('useSocketStatus', () => {
  beforeEach(() => {
    onMock.mockClear();
    offMock.mockClear();
    socketStatusStore.getState().reset();
    // The hook is session-gated; seed a session so listeners register in
    // every test. Tests that want to assert the no-session case clear it
    // explicitly.
    useSession.getState().setSession({
      id: 1,
      type: 'user',
      email: 'x@y.z',
      name: 'X',
      scopes: [],
    });
  });

  it('subscribes to connect/disconnect/connect_error/reconnect_attempt/reconnect_failed on mount', () => {
    renderHook(() => useSocketStatus());
    const events = onMock.mock.calls.map((c) => c[0]);
    expect(events).toContain('connect');
    expect(events).toContain('disconnect');
    expect(events).toContain('connect_error');
    expect(events).toContain('reconnect_attempt');
    expect(events).toContain('reconnect_failed');
  });

  it('unsubscribes all listeners on unmount', () => {
    const { unmount } = renderHook(() => useSocketStatus());
    unmount();
    const events = offMock.mock.calls.map((c) => c[0]);
    expect(events).toContain('connect');
    expect(events).toContain('disconnect');
    expect(events).toContain('connect_error');
    expect(events).toContain('reconnect_attempt');
    expect(events).toContain('reconnect_failed');
  });

  it('starts in `connected` status with null `since`', () => {
    const { result } = renderHook(() => useSocketStatus());
    expect(result.current.status).toBe('connected');
    expect(result.current.since).toBeNull();
  });

  it('transitions to `offline` on disconnect and records `since`', () => {
    const { result } = renderHook(() => useSocketStatus());
    act(() => fire('disconnect', 'transport close'));
    expect(result.current.status).toBe('offline');
    expect(result.current.since).toBeInstanceOf(Date);
  });

  it('transitions to `reconnecting` on reconnect_attempt', () => {
    const { result } = renderHook(() => useSocketStatus());
    act(() => fire('disconnect'));
    act(() => fire('reconnect_attempt', 1));
    expect(result.current.status).toBe('reconnecting');
    expect(result.current.since).toBeInstanceOf(Date);
  });

  it('transitions to `offline` on connect_error from a connected baseline', () => {
    const { result } = renderHook(() => useSocketStatus());
    act(() => fire('connect_error', new Error('boom')));
    expect(result.current.status).toBe('offline');
  });

  it('does NOT regress `reconnecting` to `offline` on retry-tick connect_error', () => {
    // Devils-#3: socket.io fires `connect_error` on every reconnect attempt
    // tick, which previously flipped the banner back to "offline" and the
    // user never saw the "Reconnecting…" state progress. The hook must keep
    // `reconnecting` sticky across these ticks.
    const { result } = renderHook(() => useSocketStatus());
    act(() => fire('disconnect'));
    act(() => fire('reconnect_attempt', 1));
    expect(result.current.status).toBe('reconnecting');
    const sinceBefore = result.current.since;
    act(() => fire('connect_error', new Error('boom')));
    expect(result.current.status).toBe('reconnecting');
    expect(result.current.since).toBe(sinceBefore);
    act(() => fire('connect_error', new Error('boom')));
    act(() => fire('reconnect_attempt', 2));
    expect(result.current.status).toBe('reconnecting');
    expect(result.current.since).toBe(sinceBefore);
  });

  it('only goes terminal-`offline` on reconnect_failed', () => {
    const { result } = renderHook(() => useSocketStatus());
    act(() => fire('disconnect'));
    act(() => fire('reconnect_attempt', 1));
    expect(result.current.status).toBe('reconnecting');
    act(() => fire('reconnect_failed'));
    expect(result.current.status).toBe('offline');
  });

  it('resets to `connected` and clears `since` on connect', () => {
    const { result } = renderHook(() => useSocketStatus());
    act(() => fire('disconnect'));
    expect(result.current.status).toBe('offline');
    act(() => fire('connect'));
    expect(result.current.status).toBe('connected');
    expect(result.current.since).toBeNull();
  });

  it('preserves `since` while in non-connected state across attempts', () => {
    const { result } = renderHook(() => useSocketStatus());
    act(() => fire('disconnect'));
    const firstSince = result.current.since;
    expect(firstSince).toBeInstanceOf(Date);
    act(() => fire('reconnect_attempt', 1));
    expect(result.current.since).toBe(firstSince);
    act(() => fire('reconnect_attempt', 2));
    expect(result.current.since).toBe(firstSince);
  });
});
