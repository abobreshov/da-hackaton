import { apiFetch } from './api-client';

/**
 * Messaging HTTP client (BFF-side).
 *
 * Mirrors the endpoints listed in `mng/specs/07-messaging.md`. The WebSocket
 * path owns the fast-delivery loop; this module handles history hydration +
 * absolute-truth hydration for a single id (e.g. reply-quote lookups).
 *
 * `id` + `reply_to` arrive as stringified bigints because Postgres BIGSERIAL
 * does not fit in a JS `number`. We parse to `bigint` at the boundary so all
 * client state (store keys, comparisons) stays type-safe.
 */

export interface MessageAuthor {
  id: number;
  username: string;
}

/**
 * Keyset-pagination cursor (see AC-07-20): ordering uses
 * `(created_at, id)` composite so the cursor must carry both values.
 */
export interface MessageCursor {
  createdAt: string;
  id: bigint;
}

/**
 * Normalised client-side message shape. Every bigint arrives as a string
 * on the wire — we parse once at the edge so downstream code can compare
 * ids and cursors without thinking about widening.
 */
export interface Message {
  id: bigint;
  roomId: number | null;
  dmId: number | null;
  author: MessageAuthor;
  body: string;
  replyTo: bigint | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface MessageList {
  messages: Message[];
  nextCursor: MessageCursor | null;
}

export interface SendMessageBody {
  roomId?: number;
  dmUserId?: number;
  body: string;
  replyToId?: bigint;
}

export interface EditMessageBody {
  body: string;
}

// -------- wire-format helpers -----------------------------------------

interface WireMessage {
  id: string | number;
  roomId?: number | null;
  room_id?: number | null;
  dmId?: number | null;
  dm_id?: number | null;
  author?: { id: number; username: string };
  authorId?: number;
  author_id?: number;
  authorUsername?: string;
  body: string;
  replyTo?: string | number | null;
  reply_to?: string | number | null;
  replyToId?: string | number | null;
  editedAt?: string | null;
  edited_at?: string | null;
  deletedAt?: string | null;
  deleted_at?: string | null;
  createdAt?: string;
  created_at?: string;
}

interface WireMessageList {
  messages: WireMessage[];
  nextCursor?: {
    createdAt?: string;
    created_at?: string;
    id: string | number;
  } | null;
}

const toBig = (v: string | number | bigint): bigint =>
  typeof v === 'bigint' ? v : BigInt(v);

const toNullableBig = (v: string | number | null | undefined): bigint | null =>
  v === null || v === undefined ? null : toBig(v);

/** Normalise a wire message into the client-side shape. Accepts snake_case
 *  or camelCase on timestamps / foreign keys because the BFF + direct backend
 *  responses historically drift — we want exactly one consumer-facing shape. */
export function normaliseMessage(raw: WireMessage): Message {
  const author =
    raw.author ??
    ({
      id: (raw.authorId ?? raw.author_id) as number,
      username: raw.authorUsername ?? '',
    } as MessageAuthor);
  return {
    id: toBig(raw.id),
    roomId: raw.roomId ?? raw.room_id ?? null,
    dmId: raw.dmId ?? raw.dm_id ?? null,
    author,
    body: raw.body,
    replyTo: toNullableBig(raw.replyTo ?? raw.reply_to ?? raw.replyToId ?? null),
    editedAt: raw.editedAt ?? raw.edited_at ?? null,
    deletedAt: raw.deletedAt ?? raw.deleted_at ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? new Date(0).toISOString(),
  };
}

function normaliseList(raw: WireMessageList): MessageList {
  const messages = raw.messages.map(normaliseMessage);
  const cursor = raw.nextCursor ?? null;
  return {
    messages,
    nextCursor:
      cursor === null
        ? null
        : {
            createdAt: (cursor.createdAt ?? cursor.created_at ?? '') as string,
            id: toBig(cursor.id),
          },
  };
}

function cursorToQuery(cursor: MessageCursor | undefined | null): string {
  if (!cursor) return '';
  const params = new URLSearchParams();
  params.set('before', cursor.createdAt);
  params.set('beforeId', cursor.id.toString());
  return `?${params.toString()}`;
}

// -------- public API --------------------------------------------------

/**
 * Fetch the newest slice of messages in a room. When `cursor` is provided,
 * walks backward using the composite keyset cursor (AC-07-20). Returns
 * `nextCursor` for the caller to feed back into `loadOlder()`.
 */
export async function listRoomMessages(
  roomId: number,
  cursor?: MessageCursor,
): Promise<MessageList> {
  const qs = cursorToQuery(cursor);
  const raw = await apiFetch<WireMessageList>(
    `/api/v1/rooms/${roomId}/messages${qs}`,
  );
  return normaliseList(raw);
}

/**
 * DM history for a conversation keyed by the other user's id. Shares the
 * same cursor semantics as `listRoomMessages`.
 */
export async function listDmMessages(
  userId: number,
  cursor?: MessageCursor,
): Promise<MessageList> {
  const qs = cursorToQuery(cursor);
  const raw = await apiFetch<WireMessageList>(
    `/api/v1/dms/${userId}/messages${qs}`,
  );
  return normaliseList(raw);
}

/**
 * Absolute-truth hydration for a single message id. Used for reply-quote
 * lookups when the parent isn't already in the local store.
 */
export async function getMessageById(id: bigint | string | number): Promise<Message> {
  const raw = await apiFetch<{ message: WireMessage } | WireMessage>(
    `/api/v1/messages/${id.toString()}`,
  );
  const wire =
    raw && typeof raw === 'object' && 'message' in raw
      ? (raw as { message: WireMessage }).message
      : (raw as WireMessage);
  return normaliseMessage(wire);
}

/**
 * HTTP send — fallback path. Hot path is `message.send` over WS; this exists
 * so callers without a socket (background jobs, tests) can still post.
 */
export async function sendMessageHttp(body: SendMessageBody): Promise<Message> {
  const raw = await apiFetch<{ message: WireMessage } | WireMessage>(
    '/api/v1/messages',
    {
      method: 'POST',
      body: JSON.stringify({
        ...body,
        replyToId: body.replyToId?.toString(),
      }),
    },
  );
  const wire =
    raw && typeof raw === 'object' && 'message' in raw
      ? (raw as { message: WireMessage }).message
      : (raw as WireMessage);
  return normaliseMessage(wire);
}

/** PATCH wrapper. WS `message.edit` is preferred; this is the HTTP twin. */
export async function editMessageHttp(
  id: bigint | string | number,
  body: EditMessageBody,
): Promise<Message> {
  const raw = await apiFetch<{ message: WireMessage } | WireMessage>(
    `/api/v1/messages/${id.toString()}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  );
  const wire =
    raw && typeof raw === 'object' && 'message' in raw
      ? (raw as { message: WireMessage }).message
      : (raw as WireMessage);
  return normaliseMessage(wire);
}

/** DELETE wrapper; 204 → resolves void. */
export const deleteMessageHttp = (id: bigint | string | number): Promise<void> =>
  apiFetch<void>(`/api/v1/messages/${id.toString()}`, { method: 'DELETE' });
