import { useEffect } from 'react';
import { create } from 'zustand';
import { useSocket } from './useSocket';
import { getSocket } from '@/lib/socket';
import { WsEvent } from '@/lib/ws-events';

export type PresenceStatus = 'online' | 'afk' | 'offline';

interface PresenceDelta {
  userId: number;
  status: PresenceStatus;
}

interface PresenceMapStore {
  map: Map<number, PresenceStatus>;
  applyDelta: (delta: PresenceDelta) => void;
  applyMany: (deltas: PresenceDelta[]) => void;
  reset: () => void;
}

/**
 * Process-wide store of userId → presence status. Exported so tests can
 * reset state between runs; callers should read via `usePresenceMap()`.
 *
 * Using zustand (already a dep) keeps the store model consistent with
 * `useSession`. Updates always produce a fresh `Map` reference so React
 * subscribers rerender.
 */
export const presenceMapStore = create<PresenceMapStore>((set) => ({
  map: new Map(),
  applyDelta: (delta) =>
    set((s) => {
      const next = new Map(s.map);
      next.set(delta.userId, delta.status);
      return { map: next };
    }),
  applyMany: (deltas) =>
    set((s) => {
      if (deltas.length === 0) return s;
      const next = new Map(s.map);
      for (const d of deltas) next.set(d.userId, d.status);
      return { map: next };
    }),
  reset: () => set({ map: new Map() }),
}));

const VALID_STATUSES: ReadonlySet<PresenceStatus> = new Set(['online', 'afk', 'offline']);

function parseDelta(raw: unknown): PresenceDelta | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.userId !== 'number') return null;
  if (typeof o.status !== 'string') return null;
  if (!VALID_STATUSES.has(o.status as PresenceStatus)) return null;
  return { userId: o.userId, status: o.status as PresenceStatus };
}

/**
 * Reads the presence map and subscribes to `presence.update` server events.
 *
 * The server may send either a flat delta `{ userId, status }` or a batched
 * payload `{ deltas: [{ userId, status }, ...] }` (gateway coalesces bursts).
 * Both shapes are accepted; malformed payloads are dropped silently — the
 * socket layer is untrusted input.
 */
export function usePresenceMap(
  userIds?: ReadonlyArray<number>,
): Map<number, PresenceStatus> {
  const map = presenceMapStore((s) => s.map);

  useSocket(WsEvent.server.presenceUpdate, (payload) => {
    const { applyDelta, applyMany } = presenceMapStore.getState();

    // Batched form.
    if (payload && typeof payload === 'object' && 'deltas' in (payload as object)) {
      const deltasRaw = (payload as { deltas: unknown }).deltas;
      if (!Array.isArray(deltasRaw)) return;
      const parsed = deltasRaw.map(parseDelta).filter((d): d is PresenceDelta => d !== null);
      if (parsed.length > 0) applyMany(parsed);
      return;
    }

    // Flat form.
    const single = parseDelta(payload);
    if (single) applyDelta(single);
  });

  // Emit `presence.subscribe` so the BFF registers this socket's interest
  // set — without it the per-socket fanout filter (`presenceOf`) stays
  // empty and every `presence.update` is dropped before reaching us.
  // Re-emits whenever the caller's id set changes (sort-join key keeps the
  // effect stable across order-only reshuffles).
  const key =
    userIds && userIds.length > 0
      ? [...userIds].sort((a, b) => a - b).join(',')
      : '';
  useEffect(() => {
    if (!key) return;
    const socket = getSocket();
    if (!socket) return;
    const ids = key.split(',').map(Number);
    const emit = (): void => {
      socket.emit(WsEvent.client.presenceSubscribe, { userIds: ids });
    };
    if (socket.connected) emit();
    socket.on('connect', emit);
    return () => {
      socket.off('connect', emit);
    };
  }, [key]);

  return map;
}
