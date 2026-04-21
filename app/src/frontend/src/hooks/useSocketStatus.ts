import { useEffect } from 'react';
import { create } from 'zustand';
import { getSocket } from '@/lib/socket';

/**
 * Connection-level status surfaced to the UI so users get visible feedback
 * when the WebSocket flaps. Distinct from message-level state (presence,
 * unread, etc) — this hook only tracks the transport.
 *
 * - `connected`    → socket is up; nothing to show.
 * - `reconnecting` → socket dropped and the client is actively retrying.
 * - `offline`      → socket dropped and we have not yet seen a retry attempt
 *                    (or the initial connection failed).
 */
export type SocketStatus = 'connected' | 'reconnecting' | 'offline';

interface SocketStatusState {
  status: SocketStatus;
  /** When the current non-connected state began. Reset to null on connect. */
  since: Date | null;
  setConnected: () => void;
  setReconnecting: () => void;
  setOffline: () => void;
  reset: () => void;
}

/**
 * Process-wide status store. Exported for tests and for the rare consumer
 * that needs a one-shot read outside React (`socketStatusStore.getState()`).
 */
export const socketStatusStore = create<SocketStatusState>((set) => ({
  status: 'connected',
  since: null,
  setConnected: () => set({ status: 'connected', since: null }),
  // Only stamp `since` when entering a non-connected state from connected;
  // subsequent retries inside the same outage should keep the original
  // timestamp so the banner can render an accurate "down for X seconds".
  setReconnecting: () =>
    set((s) => ({
      status: 'reconnecting',
      since: s.status === 'connected' || s.since === null ? new Date() : s.since,
    })),
  setOffline: () =>
    set((s) => ({
      status: 'offline',
      since: s.status === 'connected' || s.since === null ? new Date() : s.since,
    })),
  reset: () => set({ status: 'connected', since: null }),
}));

/**
 * Subscribe the status store to the singleton socket's lifecycle events.
 *
 * Mount once near the root of the authenticated tree (e.g. `_auth` layout)
 * so the banner has live data regardless of which route is active. Calling
 * the hook from multiple components is safe — listeners are scoped to each
 * caller's lifetime, and the store collapses identical state writes.
 */
export function useSocketStatus(): { status: SocketStatus; since: Date | null } {
  const status = socketStatusStore((s) => s.status);
  const since = socketStatusStore((s) => s.since);

  useEffect(() => {
    const socket = getSocket();
    // socket.io's typed event surface is restricted to its reserved-event
    // set; widen locally so we can treat it as an EventEmitter — same
    // pattern as `useSocket.ts`.
    const sock = socket as unknown as {
      on: (e: string, l: (...args: unknown[]) => void) => void;
      off: (e: string, l: (...args: unknown[]) => void) => void;
    };

    const onConnect = (): void => socketStatusStore.getState().setConnected();
    const onDisconnect = (): void => socketStatusStore.getState().setOffline();
    const onConnectError = (): void => socketStatusStore.getState().setOffline();
    const onReconnectAttempt = (): void => socketStatusStore.getState().setReconnecting();

    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    sock.on('connect_error', onConnectError);
    sock.on('reconnect_attempt', onReconnectAttempt);

    return () => {
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('connect_error', onConnectError);
      sock.off('reconnect_attempt', onReconnectAttempt);
    };
  }, []);

  return { status, since };
}
