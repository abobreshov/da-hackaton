import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { WsEvent } from '@/lib/ws-events';

const PING_INTERVAL_MS = 20_000;

/**
 * Heartbeat hook that emits `presence.ping` so the gateway can mark the
 * current session "online". Pings are paused while the tab is hidden
 * (visibilitychange) to avoid keeping users flagged "online" forever on a
 * background tab, and resume immediately on reveal.
 *
 * Mount once at the app shell — not per route.
 */
export function usePresence(): void {
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const ping = (): void => {
      socket.emit(WsEvent.client.presencePing);
    };

    const start = (): void => {
      if (intervalId !== null) return;
      ping();
      intervalId = setInterval(ping, PING_INTERVAL_MS);
    };

    const stop = (): void => {
      if (intervalId === null) return;
      clearInterval(intervalId);
      intervalId = null;
    };

    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') {
      start();
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      stop();
    };
  }, []);
}
