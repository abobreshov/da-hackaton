import { pgTable, integer, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * User-to-user bans — EPIC-04a.
 *
 * Composite PK (banner_id, banned_id) rejects duplicate rows. Both FKs
 * cascade to users because account deletion must purge ban rows mentioning
 * that account on either side.
 *
 * `user_bans_banned_idx` answers "who has banned me?" (used by the DM
 * eligibility check in EPIC-07 and by BanService to surface banlist to the
 * banned user when querying their own filtered contact view).
 */
export const userBans = pgTable(
  'user_bans',
  {
    bannerId: integer('banner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bannedId: integer('banned_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.bannerId, table.bannedId] }),
    bannedIdx: index('user_bans_banned_idx').on(table.bannedId),
  }),
);
