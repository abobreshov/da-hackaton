import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const markRoomReadMock = vi.fn();
const markDmReadMock = vi.fn();

vi.mock('@/lib/unread', async () => {
  const actual = await vi.importActual<typeof import('@/lib/unread')>('@/lib/unread');
  return {
    ...actual,
    markRoomRead: (...args: unknown[]) => markRoomReadMock(...args),
    markDmRead: (...args: unknown[]) => markDmReadMock(...args),
  };
});

import { useAutoMarkRead } from './useAutoMarkRead';
import { unreadStore } from './useUnread';

describe('useAutoMarkRead', () => {
  beforeEach(() => {
    markRoomReadMock.mockReset().mockResolvedValue(undefined);
    markDmReadMock.mockReset().mockResolvedValue(undefined);
    unreadStore.getState().reset();
    unreadStore.getState().setRoom(7, 4);
    unreadStore.getState().setDm(42, 3);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });
  afterEach(() => {
    unreadStore.getState().reset();
  });

  it('POSTs markRoomRead and zeros the local room badge', () => {
    renderHook(() => useAutoMarkRead({ kind: 'room', roomId: 7 }, '100'));
    expect(markRoomReadMock).toHaveBeenCalledWith(7, '100');
    expect(unreadStore.getState().rooms.get(7)).toBe(0);
  });

  it('POSTs markDmRead and zeros the local DM badge', () => {
    renderHook(() => useAutoMarkRead({ kind: 'dm', peerUserId: 42 }, '200'));
    expect(markDmReadMock).toHaveBeenCalledWith(42, '200');
    expect(unreadStore.getState().dms.get(42)).toBe(0);
  });

  it('does not call mark-read when lastReadId is null', () => {
    renderHook(() => useAutoMarkRead({ kind: 'room', roomId: 7 }, null));
    expect(markRoomReadMock).not.toHaveBeenCalled();
    expect(unreadStore.getState().rooms.get(7)).toBe(4);
  });

  it('skips the call when the tab is hidden', () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    renderHook(() => useAutoMarkRead({ kind: 'room', roomId: 7 }, '100'));
    expect(markRoomReadMock).not.toHaveBeenCalled();
    expect(unreadStore.getState().rooms.get(7)).toBe(4);
  });

  it('re-fires when lastReadId changes', () => {
    const { rerender } = renderHook(
      ({ id }: { id: string }) => useAutoMarkRead({ kind: 'room', roomId: 7 }, id),
      { initialProps: { id: '100' } },
    );
    expect(markRoomReadMock).toHaveBeenCalledTimes(1);
    rerender({ id: '200' });
    expect(markRoomReadMock).toHaveBeenCalledTimes(2);
    expect(markRoomReadMock).toHaveBeenLastCalledWith(7, '200');
  });

  it('swallows POST failures (server is source of truth)', () => {
    markRoomReadMock.mockRejectedValueOnce(new Error('network'));
    expect(() =>
      renderHook(() => useAutoMarkRead({ kind: 'room', roomId: 7 }, '100')),
    ).not.toThrow();
  });
});
