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
    // Default socket.io reconnection strategy is fine — exposed here for
    // discoverability. Fail loud in dev if the handshake blows up so we
    // notice mis-wired CORS / cookie config early.
    reconnection: true,
  });

  socket.on('connect_error', (err) => {
    // Avoid throwing; socket.io will retry. Log so devs see the cause.
    // eslint-disable-next-line no-console
    console.warn('[socket] connect_error', err?.message ?? err);
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
