import { useEffect, useRef, type DependencyList } from 'react';
import { getSocket } from '@/lib/socket';
import type { WsServerEventName } from '@/lib/ws-events';

/**
 * Subscribes `handler` to a server-sent Socket.IO event for the lifetime of
 * the calling component. Cleanup on unmount removes the listener.
 *
 * Re-subscribes when `deps` change; this keeps the handler closure in sync
 * without requiring callers to memoise with `useCallback`.
 */
export function useSocket<E extends WsServerEventName>(
  event: E,
  handler: (payload: unknown) => void,
  deps: DependencyList = [],
): void {
  // Keep a ref to the freshest handler so the listener we register stays
  // stable — avoids re-subscribing on every render while still calling the
  // newest function.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const socket = getSocket();
    const listener = (payload: unknown): void => handlerRef.current(payload);
    // socket.io's typed `on`/`off` generic collapses to a reserved-event
    // signature when E is not a string literal, which our event name
    // union (`WsServerEventName`) is not. Safety is already enforced at
    // the hook's `E extends WsServerEventName` bound, so we widen the
    // socket surface locally to the permissive EventEmitter-style API.
    const sock = socket as unknown as {
      on: (e: string, l: (...args: unknown[]) => void) => void;
      off: (e: string, l: (...args: unknown[]) => void) => void;
    };
    sock.on(event, listener);
    return () => {
      sock.off(event, listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}
