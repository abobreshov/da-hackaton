import { useEffect, useRef, type DependencyList } from 'react';
import { getSocket } from '@/lib/socket';
import { useSession } from '@/hooks/useSession';
import type { WsServerEventName } from '@/lib/ws-events';

/**
 * Subscribes `handler` to a server-sent Socket.IO event for the lifetime of
 * the calling component. Cleanup on unmount removes the listener.
 *
 * Re-subscribes when `deps` change; this keeps the handler closure in sync
 * without requiring callers to memoise with `useCallback`.
 *
 * Tolerates `getSocket()` returning `null` (no active session) — registers
 * nothing and waits for the session to arrive. The effect is keyed on
 * `session?.id` so when login completes the listener is wired up.
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

  // Subscribe to the session id so the registration effect re-runs once a
  // user logs in (or logs out) and `getSocket()` flips between null and the
  // live singleton.
  const sessionId = useSession((s) => s.session?.id ?? null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
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
  }, [event, sessionId, ...deps]);
}
