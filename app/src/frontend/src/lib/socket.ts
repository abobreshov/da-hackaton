/**
 * Socket.IO client singleton for the /ws namespace.
 *
 * Session is carried through the same httpOnly cookie the BFF uses for HTTP;
 * `withCredentials: true` tells the browser to include it on the upgrade
 * request. The singleton avoids the common React mistake of spawning a new
 * socket on every render/route change.
 */
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

function resolveUrl(): string {
  // Same-origin fallback — empty string makes socket.io attach to
  // `window.location.origin`, which is what we want when BFF and frontend
  // are served from the same Nginx.
  const base = import.meta.env.VITE_BFF_URL ?? '';
  return `${base}/ws`;
}

/**
 * Returns the process-wide Socket.IO client. Creates it on first call and
 * reuses it thereafter so every hook talks to the same connection.
 */
export function getSocket(): Socket {
  if (socket) return socket;

  socket = io(resolveUrl(), {
    withCredentials: true,
    reconnection: true,
    // Prefer websocket so we avoid the engine.io polling "Session ID unknown"
    // race that happens when the BFF restarts under `nest --watch` and the
    // client retries with a stale sid. The polling transport caches the sid
    // and won't self-heal; websocket re-handshakes cleanly on every dial.
    transports: ['websocket', 'polling'],
  });

  socket.on('connect_error', (err) => {
    const msg = (err as Error)?.message ?? String(err);
    // Belt-and-braces: if a stale sid still slips through (eg both transports
    // fail and polling is the last to die), tear the singleton down so the
    // next `getSocket()` builds a fresh engine. The connect-error retry loop
    // would otherwise spin forever against a server that's forgotten our sid.
    if (msg.includes('Session ID unknown')) {
      try {
        socket?.disconnect();
      } catch {
        /* noop */
      }
      socket = null;
    }
    console.warn('[socket] connect_error', msg);
  });

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
