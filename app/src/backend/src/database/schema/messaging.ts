import {
  pgTable,
  serial,
  bigserial,
  bigint,
  integer,
  text,
  timestamp,
  type AnyPgColumn,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { rooms } from './rooms';

/**
 * Direct-message channels — EPIC-07.
 *
 * Canonical ordering `user_low < user_high` + UNIQUE on the pair gives us a
 * single channel row per user pair, regardless of initiator. Both sides
 * `ON DELETE CASCADE` so account deletion (EPIC-04/EPIC-11) sweeps orphaned
 * DM rows (AC-07-13).
 *
 * `frozen_at` is set by EPIC-04's BanService transaction (source of truth).
 * EPIC-07 only READs frozen_at during message-create eligibility (AC-07-07).
 */
export const dmChannels = pgTable(
  'dm_channels',
  {
    id: serial('id').primaryKey(),
    userLow: integer('user_low')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userHigh: integer('user_high')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),
  },
  (table) => ({
    pairUnique: uniqueIndex('dm_channels_pair_unique').on(
      table.userLow,
      table.userHigh,
    ),
    canonicalOrderCheck: check(
      'dm_channels_canonical_order_check',
      sql`${table.userLow} < ${table.userHigh}`,
    ),
  }),
);

/**
 * Messages — EPIC-07.
 *
 * XOR CHECK on room_id / dm_id keeps each message scoped to exactly one
 * channel. `reply_to ON DELETE SET NULL` (AC-07-14): retention sweep may
 * delete the parent; the reply body stays readable, UI shows "replying to
 * deleted message".
 *
 * Soft-delete via `deleted_at`. Partial indexes on deleted_at IS NULL keep
 * hot-path reads narrow; separate `messages_created_prune_idx` supports the
 * retention sweep without touching the author/reply views.
 */
export const messages = pgTable(
  'messages',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    roomId: integer('room_id').references(() => rooms.id, {
      onDelete: 'cascade',
    }),
    dmId: integer('dm_id').references(() => dmChannels.id, {
      onDelete: 'cascade',
    }),
    authorId: integer('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    replyTo: bigint('reply_to', { mode: 'bigint' }).references(
      (): AnyPgColumn => messages.id,
      { onDelete: 'set null' },
    ),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    scopeXorCheck: check(
      'messages_scope_xor_check',
      sql`(${table.roomId} IS NOT NULL) <> (${table.dmId} IS NOT NULL)`,
    ),
    roomCreatedIdx: index('messages_room_created_idx')
      .on(table.roomId, table.createdAt.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    dmCreatedIdx: index('messages_dm_created_idx')
      .on(table.dmId, table.createdAt.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    replyToIdx: index('messages_reply_to_idx')
      .on(table.replyTo)
      .where(sql`${table.replyTo} IS NOT NULL`),
    authorIdx: index('messages_author_idx').on(
      table.authorId,
      table.createdAt.desc(),
    ),
    createdPruneIdx: index('messages_created_prune_idx')
      .on(table.createdAt)
      .where(sql`${table.deletedAt} IS NULL`),
  }),
);
