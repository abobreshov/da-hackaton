import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { getSocket } from '@/lib/socket';
import { WsEvent } from '@/lib/ws-events';
import {
  listRoomMessages,
  listDmMessages,
  normaliseMessage,
  type Message,
  type MessageCursor,
} from '@/lib/messages';
import type { AttachmentDto } from '@/lib/attachments';

/**
 * Normalised message store — one `Map<bigint, Message>` keyed by id + a
 * parallel ordered list so renderers don't have to re-sort on every event.
 *
 * One store per conversation (room or DM) so switching rooms doesn't bleed
 * state between them. Stores are indexed by a stable string key and cached
 * for the lifetime of the session.
 */

export interface MessagesStore {
  byId: Map<bigint, Message>;
  order: bigint[];
  oldestCursor: MessageCursor | null;
  hasMore: boolean;
  /** Message id → attachment list. Populated off the `message.send` ack +
   *  `message.new` broadcast; history fetches do NOT carry attachments yet
   *  (tracked as a follow-up), so older messages render body-only. */
  attachmentsById: Map<bigint, AttachmentDto[]>;

  /** Replace the full snapshot (initial fetch). */
  replaceAll: (messages: Message[], nextCursor: MessageCursor | null) => void;
  /** Prepend a page older than what's currently in view. */
  prependOlder: (messages: Message[], nextCursor: MessageCursor | null) => void;
  /** Insert/update a single message by id. No-op if duplicate. */
  upsert: (message: Message) => void;
  /** Attach a list of attachments to an existing message. */
  setAttachments: (id: bigint, attachments: AttachmentDto[]) => void;
  /** Patch body + editedAt on an existing message, if present. */
  applyEdit: (id: bigint, body: string, editedAt: string) => void;
  /** Mark a message as deleted; keep the row for tombstone rendering. */
  applyDelete: (id: bigint, deletedAt: string) => void;
  /** Test helper — reset to empty. */
  reset: () => void;
}

const insertSorted = (order: bigint[], byId: Map<bigint, Message>, id: bigint): bigint[] => {
  // Messages carry `createdAt` + `id`; ordering is primarily `createdAt` asc,
  // `id` as tie-breaker. We keep the array sorted ascending (oldest-first)
  // because that's the natural top-to-bottom render order in a chat view.
  const incoming = byId.get(id);
  if (!incoming) return order;
  if (order.includes(id)) return order;
  const next = [...order];
  const key = (m: Message): [string, bigint] => [m.createdAt, m.id];
  const [incTs, incId] = key(incoming);
  let idx = next.length;
  for (let i = 0; i < next.length; i++) {
    const other = byId.get(next[i]);
    if (!other) continue;
    const [otherTs, otherId] = key(other);
    if (otherTs > incTs || (otherTs === incTs && otherId > incId)) {
      idx = i;
      break;
    }
  }
  next.splice(idx, 0, id);
  return next;
};

const createMessagesStore = () =>
  create<MessagesStore>((set) => ({
    byId: new Map(),
    order: [],
    oldestCursor: null,
    hasMore: false,
    attachmentsById: new Map<bigint, AttachmentDto[]>(),
    replaceAll: (messages, nextCursor) =>
      set(() => {
        const byId = new Map<bigint, Message>();
        for (const m of messages) byId.set(m.id, m);
        // Build a freshly-sorted order.
        const order = [...byId.keys()].sort((a, b) => {
          const ma = byId.get(a)!;
          const mb = byId.get(b)!;
          if (ma.createdAt < mb.createdAt) return -1;
          if (ma.createdAt > mb.createdAt) return 1;
          return ma.id < mb.id ? -1 : ma.id > mb.id ? 1 : 0;
        });
        return {
          byId,
          order,
          oldestCursor: nextCursor,
          hasMore: nextCursor !== null,
        };
      }),
    prependOlder: (messages, nextCursor) =>
      set((s) => {
        if (messages.length === 0) {
          return {
            ...s,
            oldestCursor: nextCursor,
            hasMore: nextCursor !== null,
          };
        }
        const byId = new Map(s.byId);
        for (const m of messages) byId.set(m.id, m);
        const order = [...byId.keys()].sort((a, b) => {
          const ma = byId.get(a)!;
          const mb = byId.get(b)!;
          if (ma.createdAt < mb.createdAt) return -1;
          if (ma.createdAt > mb.createdAt) return 1;
          return ma.id < mb.id ? -1 : ma.id > mb.id ? 1 : 0;
        });
        return {
          byId,
          order,
          oldestCursor: nextCursor,
          hasMore: nextCursor !== null,
        };
      }),
    upsert: (message) =>
      set((s) => {
        const byId = new Map(s.byId);
        byId.set(message.id, message);
        const order = insertSorted(s.order, byId, message.id);
        return { ...s, byId, order };
      }),
    setAttachments: (id, attachments) =>
      set((s) => {
        if (attachments.length === 0 && !s.attachmentsById.has(id)) return s;
        const next = new Map(s.attachmentsById);
        next.set(id, attachments);
        return { ...s, attachmentsById: next };
      }),
    applyEdit: (id, body, editedAt) =>
      set((s) => {
        const prev = s.byId.get(id);
        if (!prev) return s;
        const byId = new Map(s.byId);
        byId.set(id, { ...prev, body, editedAt });
        return { ...s, byId };
      }),
    applyDelete: (id, deletedAt) =>
      set((s) => {
        const prev = s.byId.get(id);
        if (!prev) return s;
        const byId = new Map(s.byId);
        byId.set(id, { ...prev, deletedAt });
        return { ...s, byId };
      }),
    reset: () =>
      set({
        byId: new Map(),
        order: [],
        oldestCursor: null,
        hasMore: false,
        attachmentsById: new Map(),
      }),
  }));

// Store factory cache. Each conversation gets its own zustand store so
// cross-conversation state can't leak into the wrong render.
const storeCache = new Map<string, ReturnType<typeof createMessagesStore>>();

const keyFor = (args: { roomId?: number; dmUserId?: number }): string => {
  if (args.roomId !== undefined) return `room:${args.roomId}`;
  if (args.dmUserId !== undefined) return `dm:${args.dmUserId}`;
  throw new Error('useMessages: either roomId or dmUserId is required');
};

export function getMessagesStore(args: { roomId?: number; dmUserId?: number }) {
  const key = keyFor(args);
  let store = storeCache.get(key);
  if (!store) {
    store = createMessagesStore();
    storeCache.set(key, store);
  }
  return store;
}

/** Test helper — drops every cached store. */
export function resetMessagesStores(): void {
  storeCache.clear();
}

/**
 * Stitch a history-fetch's `attachmentsByMessageId` onto the messages store.
 * Keys arrive as stringified bigints (JSON-safe wire format); we widen each
 * to `bigint` and replay through `setAttachments` so message bubbles render
 * inline images / file pills on reload + scroll-back.
 */
function applyHistoryAttachments(
  state: MessagesStore,
  byId: Record<string, AttachmentDto[]> | undefined,
): void {
  if (!byId) return;
  for (const [k, v] of Object.entries(byId)) {
    if (!Array.isArray(v) || v.length === 0) continue;
    let id: bigint;
    try {
      id = BigInt(k);
    } catch {
      continue;
    }
    state.setAttachments(id, v);
  }
}

// --- WS payload shapes (server → client) ------------------------------

interface WireMessageNewPayload {
  message?: Record<string, unknown>;
  attachments?: AttachmentDto[];
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

// --- Hook -------------------------------------------------------------

export interface UseMessagesArgs {
  roomId?: number;
  dmUserId?: number;
}

export interface SendMessageArgs {
  body: string;
  replyToId?: bigint;
  attachmentIds?: string[];
}

export interface UseMessagesReturn {
  messages: Message[];
  sendMessage: (args: SendMessageArgs) => Promise<Message>;
  editMessage: (id: bigint, body: string) => Promise<void>;
  deleteMessage: (id: bigint) => Promise<void>;
  loadOlder: () => Promise<void>;
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  /** Look up attachments for a message id (if any were captured). */
  attachmentsOf: (id: bigint) => AttachmentDto[];
}

/**
 * Main messaging hook — owns the normalised store + WS subscriptions for
 * one conversation. All writes (send / edit / delete) round-trip through
 * the WS gateway; the server pushes `message.new|edited|deleted` to every
 * session (including the sender), which is the only place we update the
 * store. That keeps the local view convergent with what every other
 * participant sees.
 *
 * Important: we ALWAYS apply inbound events to the store regardless of
 * scroll position — viewport auto-scroll is the caller's concern.
 */
export function useMessages(args: UseMessagesArgs): UseMessagesReturn {
  const store = getMessagesStore(args);
  const { byId, order, attachmentsById } = store(
    useShallow((s) => ({
      byId: s.byId,
      order: s.order,
      attachmentsById: s.attachmentsById,
    })),
  );
  const hasMore = store((s) => s.hasMore);
  const messages = useMemo(() => order.map((id) => byId.get(id)!).filter(Boolean), [byId, order]);

  const attachmentsOf = useCallback(
    (id: bigint): AttachmentDto[] => attachmentsById.get(id) ?? [],
    [attachmentsById],
  );

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
        const state = store.getState();
        state.replaceAll(list.messages, list.nextCursor);
        applyHistoryAttachments(state, list.attachmentsByMessageId);
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

  // WS subscriptions — new / edited / deleted. We listen without filtering
  // by roomId at the hook level; the server is responsible for only
  // delivering events to rooms the socket has joined. For DMs the server
  // emits to `dm:{id}`, and again the socket only sees ones it's allowed to.
  useEffect(() => {
    const socket = getSocket();
    const sock = socket as unknown as {
      on: (e: string, l: (...args: unknown[]) => void) => void;
      off: (e: string, l: (...args: unknown[]) => void) => void;
    };

    const handleNew = (payload: unknown): void => {
      const p = payload as WireMessageNewPayload | undefined;
      if (!p) return;
      const wire = (p.message ?? p) as Record<string, unknown>;
      // Skip if the payload is clearly for a different conversation.
      const current = argsRef.current;
      if (current.roomId !== undefined) {
        const rid = (wire.roomId ?? wire.room_id) as number | undefined;
        if (rid !== undefined && rid !== current.roomId) return;
      } else if (current.dmUserId !== undefined) {
        // DMs carry a `dmId`; we don't know the channel id on the client
        // so we trust the room-filtered socket.
      }
      try {
        const msg = normaliseMessage(wire as never);
        store.getState().upsert(msg);
        const atts = (p.attachments ?? (wire as any).attachments) as AttachmentDto[] | undefined;
        if (Array.isArray(atts) && atts.length > 0) {
          store.getState().setAttachments(msg.id, atts);
        }
      } catch {
        // Malformed payload — drop.
      }
    };

    const handleEdited = (payload: unknown): void => {
      const p = payload as WireMessageEditedPayload | undefined;
      if (!p || p.id === undefined) return;
      const editedAt = p.editedAt ?? p.edited_at ?? new Date().toISOString();
      try {
        store.getState().applyEdit(BigInt(p.id), p.body, editedAt);
      } catch {
        /* ignore */
      }
    };

    const handleDeleted = (payload: unknown): void => {
      const p = payload as WireMessageDeletedPayload | undefined;
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

  const sendMessage = useCallback(
    (send: SendMessageArgs): Promise<Message> =>
      new Promise((resolve, reject) => {
        const socket = getSocket();
        const payload: Record<string, unknown> = { body: send.body };
        if (args.roomId !== undefined) payload.roomId = args.roomId;
        if (args.dmUserId !== undefined) payload.dmUserId = args.dmUserId;
        if (send.replyToId !== undefined) payload.replyToId = send.replyToId.toString();
        if (send.attachmentIds && send.attachmentIds.length > 0) {
          payload.attachmentIds = send.attachmentIds;
        }
        socket.emit(
          WsEvent.client.messageSend,
          payload,
          (ack: {
            message?: unknown;
            attachments?: AttachmentDto[];
            error?: { code: string; message: string };
          }) => {
            if (!ack) {
              reject(new Error('No ack from gateway'));
              return;
            }
            if (ack.error) {
              reject(Object.assign(new Error(ack.error.message), { code: ack.error.code }));
              return;
            }
            if (ack.message) {
              try {
                const msg = normaliseMessage(ack.message as never);
                store.getState().upsert(msg);
                if (Array.isArray(ack.attachments) && ack.attachments.length > 0) {
                  store.getState().setAttachments(msg.id, ack.attachments);
                }
                resolve(msg);
              } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
              }
              return;
            }
            reject(new Error('Malformed ack'));
          },
        );
      }),
    // store is stable per (roomId, dmUserId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [args.roomId, args.dmUserId],
  );

  const editMessage = useCallback(
    (id: bigint, body: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const socket = getSocket();
        socket.emit(
          WsEvent.client.messageEdit,
          { id: id.toString(), body },
          (ack: { ok?: boolean; error?: { code: string; message: string } }) => {
            if (!ack) {
              reject(new Error('No ack from gateway'));
              return;
            }
            if (ack.error) {
              reject(Object.assign(new Error(ack.error.message), { code: ack.error.code }));
              return;
            }
            resolve();
          },
        );
      }),
    [],
  );

  const deleteMessage = useCallback(
    (id: bigint): Promise<void> =>
      new Promise((resolve, reject) => {
        const socket = getSocket();
        socket.emit(
          WsEvent.client.messageDelete,
          { id: id.toString() },
          (ack: { ok?: boolean; error?: { code: string; message: string } }) => {
            if (!ack) {
              reject(new Error('No ack from gateway'));
              return;
            }
            if (ack.error) {
              reject(Object.assign(new Error(ack.error.message), { code: ack.error.code }));
              return;
            }
            resolve();
          },
        );
      }),
    [],
  );

  const loadOlder = useCallback(async (): Promise<void> => {
    const state = store.getState();
    if (!state.hasMore || !state.oldestCursor) return;
    const cursor = state.oldestCursor;
    const fetchFn =
      args.roomId !== undefined
        ? () => listRoomMessages(args.roomId!, cursor)
        : () => listDmMessages(args.dmUserId!, cursor);
    const list = await fetchFn();
    const fresh = store.getState();
    fresh.prependOlder(list.messages, list.nextCursor);
    applyHistoryAttachments(fresh, list.attachmentsByMessageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.roomId, args.dmUserId]);

  return {
    messages,
    sendMessage,
    editMessage,
    deleteMessage,
    loadOlder,
    loading,
    error,
    hasMore,
    attachmentsOf,
  };
}
