// NOTE: The `users` table is owned by the auth-service. This definition exists
// only so that backend schemas (e.g. password_resets, domain tables) can
// declare foreign keys against users(id) via Drizzle's `references()` helper.
//
// Do NOT include this table in generated migrations. When drizzle-kit emits
// CREATE TABLE users during generation, strip it from the resulting .sql file
// before committing. Auth-service manages the authoritative schema.

import { sql } from 'drizzle-orm';
import { pgTable, serial, varchar, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['ADMIN', 'USER']);
export const accessStatusEnum = pgEnum('access_status', ['ACTIVE', 'INACTIVE']);

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    role: roleEnum('role').default('USER'),
    accessStatus: accessStatusEnum('access_status').default('ACTIVE'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
    // Mirror of the auth-service column. Backend reads it to mark deleted
    // authors in chat history (messages are preserved post-delete). Do NOT
    // include in generated migrations — auth-service owns the DDL.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    // Functional index powers the case-insensitive username lookup used by
    // `UsersService.findByUsername` (BFF invite flow). Keeps the query off a
    // sequential scan as the users table grows past seed size. Migration:
    // `drizzle/0010_*.sql`.
    nameLowerIdx: index('users_name_lower_idx').on(sql`lower(${t.name})`),
  }),
);
