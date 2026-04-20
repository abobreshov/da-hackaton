import { create } from 'zustand';
import type { Message, MessageCursor } from '@/lib/messages';

/**
 * Pure normalised message store — one `Map<bigint, Message>` keyed by id +
 * a parallel ordered list so renderers don't have to re-sort on every event.
 *
 * One store instance per conversation (room or DM). Stores are keyed by a
 * stable string and cached for the lifetime of the session so cross-
 * conversation state can't bleed into the wrong render.
 *
 * This module is side-effect free: no network, no sockets, no React. The
 * `useMessagesSync` and `useMessageActions` hooks layer those concerns on
 * top so each piece is independently testable.
 */

export interface MessagesStore {
  byId: Map<bigint, Message>;
  order: bigint[];
  oldestCursor: MessageCursor | null;
  hasMore: boolean;

  /** Replace the full snapshot (initial fetch). */
  replaceAll: (messages: Message[], nextCursor: MessageCursor | null) => void;
  /** Prepend a page older than what's currently in view. */
  prependOlder: (messages: Message[], nextCursor: MessageCursor | null) => void;
  /** Insert/update a single message by id. Idempotent on the order array. */
  upsert: (message: Message) => void;
  /** Patch body + editedAt on an existing message, if present. */
  applyEdit: (id: bigint, body: string, editedAt: string) => void;
  /** Mark a message as deleted; keep the row for tombstone rendering. */
  applyDelete: (id: bigint, deletedAt: string) => void;
  /** Test helper — reset to empty. */
  reset: () => void;
}

const sortByCreatedAtThenId = (byId: Map<bigint, Message>): bigint[] =>
  [...byId.keys()].sort((a, b) => {
    const ma = byId.get(a)!;
    const mb = byId.get(b)!;
    if (ma.createdAt < mb.createdAt) return -1;
    if (ma.createdAt > mb.createdAt) return 1;
    return ma.id < mb.id ? -1 : ma.id > mb.id ? 1 : 0;
  });

const insertSorted = (order: bigint[], byId: Map<bigint, Message>, id: bigint): bigint[] => {
  // Composite (createdAt, id) sort, ascending — matches the keyset cursor
  // ordering on the server (AC-07-20). Already-present ids are no-ops so
  // re-applying the same WS broadcast doesn't dup the row.
  const incoming = byId.get(id);
  if (!incoming) return order;
  if (order.includes(id)) return order;
  const next = [...order];
  let idx = next.length;
  for (let i = 0; i < next.length; i++) {
    const other = byId.get(next[i]);
    if (!other) continue;
    if (
      other.createdAt > incoming.createdAt ||
      (other.createdAt === incoming.createdAt && other.id > incoming.id)
    ) {
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
    replaceAll: (messages, nextCursor) =>
      set(() => {
        const byId = new Map<bigint, Message>();
        for (const m of messages) byId.set(m.id, m);
        return {
          byId,
          order: sortByCreatedAtThenId(byId),
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
        return {
          byId,
          order: sortByCreatedAtThenId(byId),
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
    reset: () => set({ byId: new Map(), order: [], oldestCursor: null, hasMore: false }),
  }));

export type MessagesStoreApi = ReturnType<typeof createMessagesStore>;

// Store factory cache. One store per conversation key.
const storeCache = new Map<string, MessagesStoreApi>();

export interface ConversationKeyArgs {
  roomId?: number;
  dmUserId?: number;
}

/**
 * Build the conversation cache key. Exported so tests + downstream hooks can
 * compute the same key without duplicating the rule.
 */
export function keyForConversation(args: ConversationKeyArgs): string {
  if (args.roomId !== undefined) return `room:${args.roomId}`;
  if (args.dmUserId !== undefined) return `dm:${args.dmUserId}`;
  throw new Error('useMessages: either roomId or dmUserId is required');
}

export function getMessagesStore(args: ConversationKeyArgs): MessagesStoreApi {
  const key = keyForConversation(args);
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
