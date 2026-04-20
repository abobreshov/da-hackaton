import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

/**
 * Rooms, room memberships, room invitations — EPIC-05.
 *
 * `rooms.deleted_at` is a soft-delete marker; hard delete is driven by the
 * EPIC-11 retention worker (room-delete cascades through messages +
 * attachments via ON DELETE CASCADE).
 *
 * The trigram GIN index on `rooms.name` powers catalog search (AC-05-04).
 * `pg_trgm` extension must be enabled before the index is created; add a
 * `CREATE EXTENSION IF NOT EXISTS pg_trgm;` statement to the generated
 * migration if drizzle-kit does not emit it (drizzle does not know about
 * extensions).
 */
export const rooms = pgTable(
  'rooms',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 128 }).notNull().unique(),
    description: text('description'),
    visibility: text('visibility').notNull(),
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    visibilityCheck: check(
      'rooms_visibility_check',
      sql`${table.visibility} IN ('public','private')`,
    ),
    nameTrgmIdx: index('rooms_name_trgm').using('gin', sql`${table.name} gin_trgm_ops`),
  }),
);

export const roomMemberships = pgTable(
  'room_memberships',
  {
    roomId: integer('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.userId] }),
    roleCheck: check(
      'room_memberships_role_check',
      sql`${table.role} IN ('owner','admin','member')`,
    ),
    // Supports "my rooms" lookup without seq-scanning the full membership table.
    userIdx: index('room_memberships_user_idx').on(table.userId),
  }),
);

export const roomInvitations = pgTable(
  'room_invitations',
  {
    id: serial('id').primaryKey(),
    roomId: integer('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    inviterId: integer('inviter_id')
      .notNull()
      .references(() => users.id),
    inviteeId: integer('invitee_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  },
  (table) => ({
    roomInviteeUnique: uniqueIndex('room_invitations_room_invitee_unique').on(
      table.roomId,
      table.inviteeId,
    ),
    // Partial index: pending invitations pane (AC-05-12).
    inviteePendingIdx: index('room_invitations_invitee_pending_idx')
      .on(table.inviteeId)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.rejectedAt} IS NULL`),
  }),
);
