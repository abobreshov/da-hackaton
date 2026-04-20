import { pgTable, uuid, integer, text, timestamp, inet, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

/**
 * Durable session records for EPIC-02 (Sessions & Presence).
 *
 * Complements the ephemeral refresh-token store in Redis with a user-facing
 * list of active sessions (browser/IP). Supports per-session logout
 * (AC-02-06 / AC-02-07) and the active-sessions screen (AC-02-05).
 *
 * - `id` is a UUID (cookie-addressable, not enumerable).
 * - `ip` uses Postgres `INET` for native IPv4/IPv6 storage.
 * - `revoked_at` is NULL for active sessions; partial index speeds the
 *   common "list my active sessions" / "presence scan" queries.
 * - `users(id) ON DELETE CASCADE` so account deletion drops the session list.
 */
export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    // Partial index: only active sessions. Matches spec DDL
    //   CREATE INDEX ON user_sessions(user_id) WHERE revoked_at IS NULL;
    userActiveIdx: index('user_sessions_user_active_idx')
      .on(table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
  }),
);
