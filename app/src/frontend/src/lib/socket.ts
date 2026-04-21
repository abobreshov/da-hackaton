/**
 * Socket.IO client singleton for the /ws namespace.
 *
 * Session is carried through the same httpOnly cookie the BFF uses for HTTP;
 * `withCredentials: true` tells the browser to include it on the upgrade
 * request. The singleton avoids the common React mistake of spawning a new
 * socket on every render/route change.
 *
 * **Lazy + session-gated.** `getSocket()` is a no-op (returns null) until a
 * session is present in `useSession`. This avoids the previous behaviour of
 * dialling `/ws` from `/login` (no cookie → instant 401 → endless retry that
 * lit the ConnectionBanner up before the user had even logged in). Callers
 * that need the socket *right now* (post-login wiring) should call
 * `ensureSocket()` instead, which throws if no session is set so the
 * mis-ordering is loud rather than silent.
 */
import { io, type Socket } from 'socket.io-client';
import { useSession } from '@/hooks/useSession';

let socket: Socket | null = null;

function resolveUrl(): string {
  // Same-origin fallback — empty string makes socket.io attach to
  // `window.location.origin`, which is what we want when BFF and frontend
  // are served from the same Nginx.
  const base = import.meta.env.VITE_BFF_URL ?? '';
  return `${base}/ws`;
}

function buildSocket(): Socket {
  const sock = io(resolveUrl(), {
    withCredentials: true,
    reconnection: true,
    // Prefer websocket so we avoid the engine.io polling "Session ID unknown"
    // race that happens when the BFF restarts under `nest --watch` and the
    // client retries with a stale sid. The polling transport caches the sid
    // and won't self-heal; websocket re-handshakes cleanly on every dial.
    transports: ['websocket', 'polling'],
  });

  sock.on('connect_error', (err) => {
    const msg = (err as Error)?.message ?? String(err);
    // Belt-and-braces: if a stale sid still slips through (eg both transports
    // fail and polling is the last to die), tear the singleton down so the
    // next `getSocket()` builds a fresh engine. The connect-error retry loop
    // would otherwise spin forever against a server that's forgotten our sid.
    if (msg.includes('Session ID unknown')) {
      try {
        sock.disconnect();
      } catch {
        /* noop */
      }
      socket = null;
    }
    console.warn('[socket] connect_error', msg);
  });

  return sock;
}

/**
 * Returns the process-wide Socket.IO client *if* the user is authenticated.
 *
 * - Returns `null` when `useSession` has no active session — caller should
 *   tolerate that (no-op listener registration, no emits). Hook callers
 *   should also re-run their effect when the session changes so they
 *   subscribe once it arrives.
 * - Returns the cached singleton if already created.
 * - Otherwise creates a fresh socket and caches it.
 */
export function getSocket(): Socket | null {
  if (socket) return socket;
  const session = useSession.getState().session;
  if (!session) return null;
  socket = buildSocket();
  return socket;
}

/**
 * Eager variant for callers that *just* completed login and need the socket
 * dialled right now (e.g. the `_auth` layout effect that primes the upgrade
 * before child routes mount). Throws if no session is set so an out-of-order
 * call (pre-login) fails loudly instead of silently no-op'ing.
 */
export function ensureSocket(): Socket {
  if (socket) return socket;
  const session = useSession.getState().session;
  if (!session) {
    throw new Error('ensureSocket(): no session — call after login completes');
  }
  socket = buildSocket();
  return socket;
}

/**
 * Tears the singleton down — use on hard logout or when a test needs a
 * clean slate. Next `getSocket()` will create a fresh connection.
 */
export function disconnect(): void {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}
