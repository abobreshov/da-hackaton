import {
  pgTable,
  uuid,
  integer,
  bigint,
  text,
  boolean,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { rooms } from './rooms';
import { dmChannels, messages } from './messaging';

/**
 * Attachments — EPIC-08.
 *
 * XOR CHECK on room_id / dm_id mirrors messages (an attachment belongs to
 * exactly one channel scope). `message_id ON DELETE SET NULL` lets retention
 * prune messages before attachments; the FS sweep runs independently.
 *
 * Four indexes (AC-08-10):
 *  - message_idx     — download ACL check "is this attachment on message X?"
 *  - room_created    — per-room listing ordered by time
 *  - dm_created      — per-DM listing
 *  - created_prune   — retention sweep uses created_at alone
 */
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey(),
    roomId: integer('room_id').references(() => rooms.id, {
      onDelete: 'cascade',
    }),
    dmId: integer('dm_id').references(() => dmChannels.id, {
      onDelete: 'cascade',
    }),
    messageId: bigint('message_id', { mode: 'bigint' }).references(() => messages.id, {
      onDelete: 'set null',
    }),
    uploaderId: integer('uploader_id')
      .notNull()
      .references(() => users.id),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    path: text('path').notNull(),
    comment: text('comment'),
    isImage: boolean('is_image').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    scopeXorCheck: check(
      'attachments_scope_xor_check',
      sql`(${table.roomId} IS NOT NULL) <> (${table.dmId} IS NOT NULL)`,
    ),
    messageIdx: index('attachments_message_idx')
      .on(table.messageId)
      .where(sql`${table.messageId} IS NOT NULL`),
    roomCreatedIdx: index('attachments_room_created_idx')
      .on(table.roomId, table.createdAt)
      .where(sql`${table.roomId} IS NOT NULL`),
    dmCreatedIdx: index('attachments_dm_created_idx')
      .on(table.dmId, table.createdAt)
      .where(sql`${table.dmId} IS NOT NULL`),
    createdPruneIdx: index('attachments_created_prune_idx').on(table.createdAt),
  }),
);
