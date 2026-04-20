import {
  pgTable,
  integer,
  bigint,
  timestamp,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { rooms } from './rooms';
import { dmChannels } from './messaging';

/**
 * Per-user, per-thread last-read marker — EPIC-09.
 *
 * NOT using a functional PK: Postgres does not support `PRIMARY KEY` over
 * expressions. We emulate uniqueness with a functional UNIQUE index over
 * `(user_id, COALESCE(room_id, 0), COALESCE(dm_id, 0))` — this is the
 * AC-09-06 contract. The XOR CHECK enforces exactly one of room_id / dm_id.
 *
 * Upserts use `ON CONFLICT ... ` targeting `user_last_read_scope_idx` as the
 * conflict target (functional index must be named in the ON CONFLICT clause
 * via `ON CONFLICT (user_id, COALESCE(room_id,0), COALESCE(dm_id,0))`).
 */
export const userLastRead = pgTable(
  'user_last_read',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roomId: integer('room_id').references(() => rooms.id, {
      onDelete: 'cascade',
    }),
    dmId: integer('dm_id').references(() => dmChannels.id, {
      onDelete: 'cascade',
    }),
    lastReadId: bigint('last_read_id', { mode: 'bigint' }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    scopeXorCheck: check(
      'user_last_read_scope_xor_check',
      sql`(${table.roomId} IS NOT NULL) <> (${table.dmId} IS NOT NULL)`,
    ),
    scopeUnique: uniqueIndex('user_last_read_scope_idx').on(
      table.userId,
      sql`COALESCE(${table.roomId}, 0)`,
      sql`COALESCE(${table.dmId}, 0)`,
    ),
  }),
);
