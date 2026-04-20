import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

/**
 * Friend graph — EPIC-04a (Contacts, Friends).
 *
 * Pair normalised by sorting ids so `(user_a, user_b)` is unique regardless of
 * who initiated. The `requested_by IN (user_a, user_b)` CHECK prevents
 * third-party forgery; `user_a < user_b` enforces canonical ordering.
 *
 * Three partial indexes serve the hot paths:
 *  - accepted friend lookup from either side (two indexes, one per side)
 *  - pending inbox: list pending requests addressed to user_b (inbox UX)
 */
export const friendships = pgTable(
  'friendships',
  {
    id: serial('id').primaryKey(),
    userA: integer('user_a')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userB: integer('user_b')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    requestedBy: integer('requested_by')
      .notNull()
      .references(() => users.id),
    requestText: text('request_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  (table) => ({
    statusCheck: check('friendships_status_check', sql`${table.status} IN ('pending','accepted')`),
    requestedByCheck: check(
      'friendships_requested_by_check',
      sql`${table.requestedBy} IN (${table.userA}, ${table.userB})`,
    ),
    canonicalOrderCheck: check(
      'friendships_canonical_order_check',
      sql`${table.userA} < ${table.userB}`,
    ),
    pairUnique: uniqueIndex('friendships_pair_unique').on(table.userA, table.userB),
    userAAcceptedIdx: index('friendships_user_a_accepted_idx')
      .on(table.userA)
      .where(sql`${table.status} = 'accepted'`),
    userBAcceptedIdx: index('friendships_user_b_accepted_idx')
      .on(table.userB)
      .where(sql`${table.status} = 'accepted'`),
    pendingIdx: index('friendships_pending_idx')
      .on(table.userB)
      .where(sql`${table.status} = 'pending'`),
  }),
);
