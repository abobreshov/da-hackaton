import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getSocket } from '@/lib/socket';
import { WsEvent } from '@/lib/ws-events';
import { listRoomMessages, listDmMessages, normaliseMessage, type Message } from '@/lib/messages';
import { getMessagesStore, type ConversationKeyArgs } from './useMessagesStore';

/**
 * Hydration + WS subscription for one conversation. Owns:
 *
 *  1. the initial HTTP fetch (`listRoomMessages` / `listDmMessages`),
 *  2. a `loadOlder` paginator that walks backward via the keyset cursor,
 *  3. the `message.new|edited|deleted` socket subscriptions.
 *
 * It writes into the conversation's zustand store but reads no derived
 * state itself — the facade hook composes this with `useMessageActions`
 * and exposes the final API surface.
 */

// --- WS payload shapes (server → client) ------------------------------

interface WireMessageNewPayload {
  message?: Record<string, unknown>;
  roomId?: number;
  dmId?: number;
  [k: string]: unknown;
}

interface WireMessageEditedPayload {
  id: string | number;
  body: string;
  editedAt?: string;
  edited_at?: string;
  roomId?: number;
  dmId?: number;
}

interface WireMessageDeletedPayload {
  id: string | number;
  deletedAt?: string;
  deleted_at?: string;
  roomId?: number;
  dmId?: number;
}

export interface UseMessagesSyncReturn {
  messages: Message[];
  loadOlder: () => Promise<void>;
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
}

export function useMessagesSync(args: ConversationKeyArgs): UseMessagesSyncReturn {
  const store = getMessagesStore(args);
  const { byId, order } = store(useShallow((s) => ({ byId: s.byId, order: s.order })));
  const hasMore = store((s) => s.hasMore);
  const messages = useMemo(() => order.map((id) => byId.get(id)!).filter(Boolean), [byId, order]);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const argsRef = useRef(args);
  argsRef.current = args;

  // Initial fetch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const fetchFn =
      args.roomId !== undefined
        ? () => listRoomMessages(args.roomId!)
        : () => listDmMessages(args.dmUserId!);
    fetchFn()
      .then((list) => {
        if (cancelled) return;
        store.getState().replaceAll(list.messages, list.nextCursor);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch when the conversation switches. `store` is stable per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.roomId, args.dmUserId]);

  // WS subscriptions — new / edited / deleted. Server is responsible for
  // only delivering events to rooms/DMs the socket has joined; we still
  // filter by roomId on `message.new` as defence-in-depth.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const sock = socket as unknown as {
      on: (e: string, l: (...args: unknown[]) => void) => void;
      off: (e: string, l: (...args: unknown[]) => void) => void;
    };

    const handleNew = (payload: unknown): void => {
      const p = payload as WireMessageNewPayload | undefined;
      if (!p) return;
      const wire = (p.message ?? p) as Record<string, unknown>;
      const current = argsRef.current;
      if (current.roomId !== undefined) {
        const rid = (wire.roomId ?? wire.room_id) as number | undefined;
        if (rid !== undefined && rid !== current.roomId) return;
      }
      try {
        const msg = normaliseMessage(wire as never);
        store.getState().upsert(msg);
      } catch {
        // Malformed payload — drop.
      }
    };

    const handleEdited = (payload: unknown): void => {
      const wrap = payload as { message?: WireMessageEditedPayload } | undefined;
      const p = (wrap?.message ?? wrap) as WireMessageEditedPayload | undefined;
      if (!p || p.id === undefined) return;
      const editedAt = p.editedAt ?? p.edited_at ?? new Date().toISOString();
      try {
        store.getState().applyEdit(BigInt(p.id), p.body, editedAt);
      } catch {
        /* ignore */
      }
    };

    const handleDeleted = (payload: unknown): void => {
      const wrap = payload as { message?: WireMessageDeletedPayload } | undefined;
      const p = (wrap?.message ?? wrap) as WireMessageDeletedPayload | undefined;
      if (!p || p.id === undefined) return;
      const deletedAt = p.deletedAt ?? p.deleted_at ?? new Date().toISOString();
      try {
        store.getState().applyDelete(BigInt(p.id), deletedAt);
      } catch {
        /* ignore */
      }
    };

    sock.on(WsEvent.server.messageNew, handleNew);
    sock.on(WsEvent.server.messageEdited, handleEdited);
    sock.on(WsEvent.server.messageDeleted, handleDeleted);

    return () => {
      sock.off(WsEvent.server.messageNew, handleNew);
      sock.off(WsEvent.server.messageEdited, handleEdited);
      sock.off(WsEvent.server.messageDeleted, handleDeleted);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.roomId, args.dmUserId]);

  const loadOlder = useCallback(async (): Promise<void> => {
    const state = store.getState();
    if (!state.hasMore || !state.oldestCursor) return;
    const cursor = state.oldestCursor;
    const fetchFn =
      args.roomId !== undefined
        ? () => listRoomMessages(args.roomId!, cursor)
        : () => listDmMessages(args.dmUserId!, cursor);
    const list = await fetchFn();
    store.getState().prependOlder(list.messages, list.nextCursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.roomId, args.dmUserId]);

  return { messages, loadOlder, loading, error, hasMore };
}
