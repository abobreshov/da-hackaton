import { pgTable, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Password reset tokens for EPIC-01 (Accounts & Authentication).
 *
 * - `tokenHash` is the PK: the plaintext token is emailed to the user, and we
 *   only persist its hash (bcrypt/sha-256 TBD in service layer).
 * - `expiresAt` enforces the 1h TTL (AC-01-07).
 * - `usedAt` marks single-use redemption (non-null = already consumed).
 * - `users(id) ON DELETE CASCADE` so account deletion (EPIC-01 / EPIC-11)
 *   cleans up any outstanding reset tokens automatically.
 * - Index on `user_id` supports "invalidate all resets for this user"
 *   operations and per-user reset-request rate-limiting lookups.
 */
export const passwordResets = pgTable(
  'password_resets',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => ({
    passwordResetsUserIdx: index('password_resets_user_idx').on(table.userId),
  }),
);
