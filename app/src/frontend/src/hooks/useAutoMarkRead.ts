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
  useEffect(() => {
    if (!lastReadId) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // Tab hidden — user isn't looking; skip. Next focus change + message
      // delivery will re-trigger.
      return;
    }

    if (scope.kind === 'room') {
      unreadStore.getState().clearRoom(scope.roomId);
      void markRoomRead(scope.roomId, lastReadId).catch(() => {
        /* fail-open — server is source of truth via WS */
      });
    } else {
      unreadStore.getState().clearDm(scope.peerUserId);
      void markDmRead(scope.peerUserId, lastReadId).catch(() => {
        /* fail-open */
      });
    }
  }, [scope.kind, scope.kind === 'room' ? scope.roomId : scope.peerUserId, lastReadId]);
}
