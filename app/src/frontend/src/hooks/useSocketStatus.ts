import { useEffect } from 'react';
import { create } from 'zustand';
import { getSocket } from '@/lib/socket';
import { useSession } from '@/hooks/useSession';

/**
 * Connection-level status surfaced to the UI so users get visible feedback
 * when the WebSocket flaps. Distinct from message-level state (presence,
 * unread, etc) — this hook only tracks the transport.
 *
 * - `connected`    → socket is up; nothing to show.
 * - `reconnecting` → socket dropped and the client is actively retrying.
 * - `offline`      → either the very first attempt failed or the retry
 *                    budget has been exhausted (`reconnect_failed`).
 */
export type SocketStatus = 'connected' | 'reconnecting' | 'offline';

interface SocketStatusState {
  status: SocketStatus;
  /** When the current non-connected state began. Reset to null on connect. */
  since: Date | null;
  setConnected: () => void;
  setReconnecting: () => void;
  /** Demote to `offline` from a *connected* baseline (initial-dial failure
   *  or a fresh disconnect we haven't yet started retrying). Once we are
   *  already in `reconnecting`, the per-tick `connect_error` events MUST
   *  NOT regress us back to `offline` — that was the prior bug where the
   *  banner stuck on "Connection lost" instead of progressing to
   *  "Reconnecting…" during a normal flap. */
  setOfflineSoft: () => void;
  /** Terminal `offline` (`reconnect_failed`) — the client has given up; we
   *  go offline regardless of current state and re-stamp `since` only when
   *  we don't already have one. */
  setOfflineTerminal: () => void;
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
  setOfflineSoft: () =>
    set((s) => {
      // If we are already retrying, leave the state alone — `connect_error`
      // is emitted on every retry tick and must not undo the
      // `reconnect_attempt` we already promoted to.
      if (s.status === 'reconnecting') return s;
      // First-failure path: stamp `since` only if we are coming from
      // `connected` (or from a stale state with no timestamp).
      return {
        status: 'offline',
        since: s.status === 'connected' || s.since === null ? new Date() : s.since,
      };
    }),
  setOfflineTerminal: () =>
    set((s) => ({
      status: 'offline',
      since: s.since ?? new Date(),
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
 *
 * Tolerates `getSocket()` returning `null` (no session) — registers nothing
 * and re-runs once a session arrives so the unauthenticated routes don't
 * spawn a connection (or render a misleading "Connection lost" banner).
 */
export function useSocketStatus(): { status: SocketStatus; since: Date | null } {
  const status = socketStatusStore((s) => s.status);
  const since = socketStatusStore((s) => s.since);
  const sessionId = useSession((s) => s.session?.id ?? null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    // socket.io's typed event surface is restricted to its reserved-event
    // set; widen locally so we can treat it as an EventEmitter — same
    // pattern as `useSocket.ts`.
    const sock = socket as unknown as {
      on: (e: string, l: (...args: unknown[]) => void) => void;
      off: (e: string, l: (...args: unknown[]) => void) => void;
    };

    const onConnect = (): void => socketStatusStore.getState().setConnected();
    const onDisconnect = (): void => socketStatusStore.getState().setOfflineSoft();
    // `connect_error` fires on every retry tick — feed it through the soft
    // path, which is a no-op when we are already `reconnecting`.
    const onConnectError = (): void => socketStatusStore.getState().setOfflineSoft();
    const onReconnectAttempt = (): void => socketStatusStore.getState().setReconnecting();
    const onReconnectFailed = (): void => socketStatusStore.getState().setOfflineTerminal();

    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    sock.on('connect_error', onConnectError);
    sock.on('reconnect_attempt', onReconnectAttempt);
    sock.on('reconnect_failed', onReconnectFailed);

    return () => {
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('connect_error', onConnectError);
      sock.off('reconnect_attempt', onReconnectAttempt);
      sock.off('reconnect_failed', onReconnectFailed);
    };
  }, [sessionId]);

  return { status, since };
}
