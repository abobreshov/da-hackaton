import { describe, it, expect, vi, beforeEach, expectTypeOf } from 'vitest';
import { renderHook } from '@testing-library/react';

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

import { useSocket } from './useSocket';
import { WsEvent, type WsServerEventName } from '@/lib/ws-events';

describe('useSocket', () => {
  beforeEach(() => {
    onMock.mockClear();
    offMock.mockClear();
  });

  it('subscribes on mount and unsubscribes on unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useSocket(WsEvent.server.messageNew, handler),
    );

    expect(onMock).toHaveBeenCalledTimes(1);
    expect(onMock).toHaveBeenCalledWith('message.new', expect.any(Function));

    unmount();

    expect(offMock).toHaveBeenCalledTimes(1);
    expect(offMock).toHaveBeenCalledWith('message.new', expect.any(Function));
  });

  it('forwards the received payload to the caller handler', () => {
    const handler = vi.fn();
    renderHook(() => useSocket(WsEvent.server.presenceUpdate, handler));
    const registered = onMock.mock.calls[0][1] as (p: unknown) => void;
    registered({ userId: 'u1', status: 'online' });
    expect(handler).toHaveBeenCalledWith({ userId: 'u1', status: 'online' });
  });

  it('accepts any valid WsServerEventName at the type level', () => {
    // Compile-time assertion: the event-name parameter is typed against the union.
    expectTypeOf(useSocket<WsServerEventName>).parameters.toMatchTypeOf<
      [WsServerEventName, (payload: unknown) => void, ...unknown[]]
    >();
  });
});
