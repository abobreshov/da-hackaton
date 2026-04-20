import { useEffect } from 'react';
import { create } from 'zustand';
import { useSocket } from './useSocket';
import { WsEvent } from '@/lib/ws-events';
import { getUnreadCounts, type UnreadCountsDto } from '@/lib/unread';

/** UI cap — the backend already clamps at 99 per AC-09-03; this matches. */
export const UNREAD_BADGE_CAP = 99;

interface UnreadStore {
  /** roomId → count */
  rooms: Map<number, number>;
  /** peer userId → count (DMs keyed by peer for route parity) */
  dms: Map<number, number>;
  hydrated: boolean;
  hydrate: (counts: UnreadCountsDto) => void;
  setRoom: (roomId: number, count: number) => void;
  setDm: (peerUserId: number, count: number) => void;
  clearRoom: (roomId: number) => void;
  clearDm: (peerUserId: number) => void;
  reset: () => void;
}

/**
 * Process-wide unread badge store. Keyed by routing identifiers (roomId for
 * rooms, peer userId for DMs) so components can look up by the same value
 * they already have on hand.
 *
 * Counts are capped at {@link UNREAD_BADGE_CAP} on write — both the REST
 * response and the WS delta are pre-capped by the backend, but an extra
 * clamp here keeps the invariant local so UI renders "99+" can assume it.
 */
export const unreadStore = create<UnreadStore>((set) => ({
  rooms: new Map(),
  dms: new Map(),
  hydrated: false,
  hydrate: (counts) =>
    set(() => ({
      rooms: new Map(counts.rooms.map((r) => [r.roomId, clamp(r.count)])),
      dms: new Map(counts.dms.map((d) => [d.peerUserId, clamp(d.count)])),
      hydrated: true,
    })),
  setRoom: (roomId, count) =>
    set((s) => {
      const next = new Map(s.rooms);
      next.set(roomId, clamp(count));
      return { rooms: next };
    }),
  setDm: (peerUserId, count) =>
    set((s) => {
      const next = new Map(s.dms);
      next.set(peerUserId, clamp(count));
      return { dms: next };
    }),
  clearRoom: (roomId) =>
    set((s) => {
      if (!s.rooms.has(roomId)) return s;
      const next = new Map(s.rooms);
      next.set(roomId, 0);
      return { rooms: next };
    }),
  clearDm: (peerUserId) =>
    set((s) => {
      if (!s.dms.has(peerUserId)) return s;
      const next = new Map(s.dms);
      next.set(peerUserId, 0);
      return { dms: next };
    }),
  reset: () => set({ rooms: new Map(), dms: new Map(), hydrated: false }),
}));

function clamp(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.trunc(n), UNREAD_BADGE_CAP);
}

interface UnreadChangedPayload {
  scope?: { roomId?: number; dmId?: number; peerUserId?: number } | null;
  count?: number;
}

function parseDelta(raw: unknown): {
  key: { roomId: number } | { peerUserId: number };
  count: number;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const { scope, count } = raw as UnreadChangedPayload;
  if (typeof count !== 'number' || !Number.isFinite(count)) return null;
  if (!scope || typeof scope !== 'object') return null;
  if (typeof scope.roomId === 'number') {
    return { key: { roomId: scope.roomId }, count };
  }
  if (typeof scope.peerUserId === 'number') {
    return { key: { peerUserId: scope.peerUserId }, count };
  }
  return null;
}

/**
 * Hook that keeps the unread store in sync with the server.
 *
 * - Hydrates once from GET /unread on first mount.
 * - Applies WS `unread.changed` deltas live.
 * - Returns selectors so components can read room/DM counts cheaply.
 *
 * Mark-read mutations live in {@link markRoomRead} / {@link markDmRead} in
 * `lib/unread.ts` — callers invoke them via `useUnreadActions` below.
 */
export function useUnread(): {
  rooms: Map<number, number>;
  dms: Map<number, number>;
  hydrated: boolean;
} {
  const rooms = unreadStore((s) => s.rooms);
  const dms = unreadStore((s) => s.dms);
  const hydrated = unreadStore((s) => s.hydrated);

  useEffect(() => {
    if (unreadStore.getState().hydrated) return;
    let cancelled = false;
    void getUnreadCounts()
      .then((counts) => {
        if (!cancelled) unreadStore.getState().hydrate(counts);
      })
      .catch(() => {
        // Fail-open: empty store is a safe fallback — badges just won't
        // render until the next WS delta. No user-facing error.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useSocket(WsEvent.server.unreadChanged, (payload) => {
    const delta = parseDelta(payload);
    if (!delta) return;
    if ('roomId' in delta.key) {
      unreadStore.getState().setRoom(delta.key.roomId, delta.count);
    } else {
      unreadStore.getState().setDm(delta.key.peerUserId, delta.count);
    }
  });

  return { rooms, dms, hydrated };
}
