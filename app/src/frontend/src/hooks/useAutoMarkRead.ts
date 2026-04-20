import { useEffect } from 'react';
import { markDmRead, markRoomRead } from '@/lib/unread';
import { unreadStore } from './useUnread';

export type MarkReadScope = { kind: 'room'; roomId: number } | { kind: 'dm'; peerUserId: number };

/**
 * Automatically marks the active chat scope read up to `lastReadId` when:
 *   - the chat viewport is mounted and visible (document.visibilityState)
 *   - `lastReadId` changes (new messages arrive / initial hydrate)
 *
 * Optimistically zeroes the local badge so the sidebar reflects the mark
 * without waiting for the server's `unread.changed` round-trip. If the
 * POST fails we do NOT roll back — the server remains authoritative and
 * will push a fresh count via WS on the next new message anyway.
 */
export function useAutoMarkRead(scope: MarkReadScope, lastReadId: string | null | undefined): void {
  // Flatten the discriminated scope once so the effect's dep array is a
  // plain tuple of primitives — avoids a conditional expression inside the
  // deps (which react-hooks/exhaustive-deps can't statically verify).
  const kind = scope.kind;
  const scopeId = scope.kind === 'room' ? scope.roomId : scope.peerUserId;
  useEffect(() => {
    if (!lastReadId) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // Tab hidden — user isn't looking; skip. Next focus change + message
      // delivery will re-trigger.
      return;
    }

    if (kind === 'room') {
      unreadStore.getState().clearRoom(scopeId);
      void markRoomRead(scopeId, lastReadId).catch(() => {
        /* fail-open — server is source of truth via WS */
      });
    } else {
      unreadStore.getState().clearDm(scopeId);
      void markDmRead(scopeId, lastReadId).catch(() => {
        /* fail-open */
      });
    }
  }, [kind, scopeId, lastReadId]);
}
