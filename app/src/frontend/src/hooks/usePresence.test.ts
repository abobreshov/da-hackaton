import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from 'react';

const emitMock = vi.fn();
const getSocketMock = vi.fn(() => ({
  emit: emitMock,
  on: vi.fn(),
  off: vi.fn(),
  connected: true,
}));

vi.mock('@/lib/socket', () => ({
  getSocket: () => getSocketMock(),
  disconnect: vi.fn(),
}));

import { usePresence } from './usePresence';

describe('usePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    emitMock.mockClear();
    getSocketMock.mockClear();
    // Default: tab visible.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits presence.ping immediately on mount', () => {
    renderHook(() => usePresence());
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith('presence.ping');
  });

  it('continues to emit every 20 seconds', () => {
    renderHook(() => usePresence());
    emitMock.mockClear();

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(emitMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(emitMock).toHaveBeenCalledTimes(2);
  });

  it('stops pinging while the tab is hidden, resumes when visible again', () => {
    renderHook(() => usePresence());
    emitMock.mockClear();

    // Hide the tab.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Advancing time should NOT produce more pings.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(emitMock).not.toHaveBeenCalled();

    // Reveal the tab.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // On reveal it pings immediately, then resumes cadence.
    expect(emitMock).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(emitMock).toHaveBeenCalledTimes(2);
  });

  it('clears its interval + listeners on unmount', () => {
    const { unmount } = renderHook(() => usePresence());
    emitMock.mockClear();

    unmount();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(emitMock).not.toHaveBeenCalled();
  });
});
