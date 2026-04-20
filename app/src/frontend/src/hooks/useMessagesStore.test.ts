import { describe, it, expect, beforeEach } from 'vitest';
import { getMessagesStore, resetMessagesStores, keyForConversation } from './useMessagesStore';
import type { Message, MessageCursor } from '@/lib/messages';

/**
 * Pure zustand store contract. These tests touch only state ops — no
 * network, no sockets, no React render. If a behaviour needs a side
 * effect, it belongs in `useMessagesSync` / `useMessageActions`.
 */

const mkMessage = (
  id: bigint,
  body: string,
  createdAt: string,
  overrides: Partial<Message> = {},
): Message => ({
  id,
  roomId: 42,
  dmId: null,
  author: { id: 1, username: 'alice' },
  body,
  replyTo: null,
  editedAt: null,
  deletedAt: null,
  createdAt,
  ...overrides,
});

describe('useMessagesStore (pure state)', () => {
  beforeEach(() => {
    resetMessagesStores();
  });

  it('keyForConversation builds distinct keys for rooms vs DMs', () => {
    expect(keyForConversation({ roomId: 42 })).toBe('room:42');
    expect(keyForConversation({ dmUserId: 7 })).toBe('dm:7');
    expect(() => keyForConversation({})).toThrow(/roomId or dmUserId/);
  });

  it('returns the same store instance for the same conversation key', () => {
    const a = getMessagesStore({ roomId: 42 });
    const b = getMessagesStore({ roomId: 42 });
    expect(a).toBe(b);
  });

  it('returns distinct stores for different conversations', () => {
    const room = getMessagesStore({ roomId: 42 });
    const dm = getMessagesStore({ dmUserId: 7 });
    expect(room).not.toBe(dm);
  });

  it('replaceAll() seeds byId + order sorted by (createdAt, id)', () => {
    const store = getMessagesStore({ roomId: 42 });
    const cursor: MessageCursor = { createdAt: '2026-04-20T10:00:00.000Z', id: 1n };
    store
      .getState()
      .replaceAll(
        [
          mkMessage(2n, 'world', '2026-04-20T10:01:00.000Z'),
          mkMessage(1n, 'hello', '2026-04-20T10:00:00.000Z'),
        ],
        cursor,
      );
    const { order, byId, oldestCursor, hasMore } = store.getState();
    expect(order).toEqual([1n, 2n]);
    expect(byId.get(1n)?.body).toBe('hello');
    expect(byId.get(2n)?.body).toBe('world');
    expect(oldestCursor).toEqual(cursor);
    expect(hasMore).toBe(true);
  });

  it('upsert() inserts a new message and updates an existing one in place', () => {
    const store = getMessagesStore({ roomId: 42 });
    store.getState().replaceAll([mkMessage(1n, 'hello', '2026-04-20T10:00:00.000Z')], null);
    store.getState().upsert(mkMessage(2n, 'new', '2026-04-20T10:02:00.000Z'));
    expect(store.getState().order).toEqual([1n, 2n]);
    // Re-upserting the same id is idempotent (no dup in order).
    store.getState().upsert(mkMessage(2n, 'new (same)', '2026-04-20T10:02:00.000Z'));
    expect(store.getState().order).toEqual([1n, 2n]);
    expect(store.getState().byId.get(2n)?.body).toBe('new (same)');
  });

  it('applyEdit() patches body + editedAt when the id exists; ignores otherwise', () => {
    const store = getMessagesStore({ roomId: 42 });
    store.getState().replaceAll([mkMessage(5n, 'orig', '2026-04-20T10:00:00.000Z')], null);
    store.getState().applyEdit(5n, 'edited!', '2026-04-20T10:05:00.000Z');
    expect(store.getState().byId.get(5n)?.body).toBe('edited!');
    expect(store.getState().byId.get(5n)?.editedAt).toBe('2026-04-20T10:05:00.000Z');
    // No-op for missing id.
    store.getState().applyEdit(999n, 'x', '2026-04-20T10:06:00.000Z');
    expect(store.getState().byId.has(999n)).toBe(false);
  });

  it('applyDelete() leaves the row (tombstone) but marks deletedAt', () => {
    const store = getMessagesStore({ roomId: 42 });
    store.getState().replaceAll([mkMessage(5n, 'orig', '2026-04-20T10:00:00.000Z')], null);
    store.getState().applyDelete(5n, '2026-04-20T10:05:00.000Z');
    expect(store.getState().byId.get(5n)?.deletedAt).toBe('2026-04-20T10:05:00.000Z');
    // Still in the order — tombstone rendering uses the row.
    expect(store.getState().order).toEqual([5n]);
  });

  it('prependOlder() merges an older page and keeps the composite-key sort order', () => {
    const store = getMessagesStore({ roomId: 42 });
    store
      .getState()
      .replaceAll([mkMessage(10n, 'newest', '2026-04-20T10:10:00.000Z')], {
        createdAt: '2026-04-20T10:10:00.000Z',
        id: 10n,
      });
    store.getState().prependOlder([mkMessage(5n, 'older', '2026-04-20T09:00:00.000Z')], null);
    const s = store.getState();
    expect(s.order).toEqual([5n, 10n]);
    expect(s.oldestCursor).toBeNull();
    expect(s.hasMore).toBe(false);
  });

  it('prependOlder() with an empty page still advances the cursor/hasMore', () => {
    const store = getMessagesStore({ roomId: 42 });
    store
      .getState()
      .replaceAll([mkMessage(10n, 'newest', '2026-04-20T10:10:00.000Z')], {
        createdAt: '2026-04-20T10:10:00.000Z',
        id: 10n,
      });
    store.getState().prependOlder([], null);
    expect(store.getState().hasMore).toBe(false);
    expect(store.getState().oldestCursor).toBeNull();
  });

  it('resetMessagesStores() drops every cached store (new instances after)', () => {
    const first = getMessagesStore({ roomId: 42 });
    resetMessagesStores();
    const second = getMessagesStore({ roomId: 42 });
    expect(second).not.toBe(first);
  });
});
