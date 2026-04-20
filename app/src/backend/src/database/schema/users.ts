// NOTE: The `users` table is owned by the auth-service. This definition exists
// only so that backend schemas (e.g. password_resets, domain tables) can
// declare foreign keys against users(id) via Drizzle's `references()` helper.
//
// Do NOT include this table in generated migrations. When drizzle-kit emits
// CREATE TABLE users during generation, strip it from the resulting .sql file
// before committing. Auth-service manages the authoritative schema.

import { pgTable, serial, varchar, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['ADMIN', 'USER']);
export const accessStatusEnum = pgEnum('access_status', ['ACTIVE', 'INACTIVE']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  role: roleEnum('role').default('USER'),
  accessStatus: accessStatusEnum('access_status').default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
