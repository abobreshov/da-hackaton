import {
  pgTable,
  bigserial,
  integer,
  bigint,
  text,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { rooms } from './rooms';
import { messages } from './messaging';

/**
 * Room bans — EPIC-06.
 *
 * Distinct from user_bans (EPIC-04a): room_bans is per-room. Remove-member
 * action writes a row here (AC-06-05). Cascade on room delete + user delete.
 */
export const roomBans = pgTable(
  'room_bans',
  {
    roomId: integer('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bannedBy: integer('banned_by')
      .notNull()
      .references(() => users.id),
    bannedAt: timestamp('banned_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.userId] }),
  }),
);

/**
 * Abuse reports — EPIC-06.
 *
 * - Partial UNIQUE `(reporter_id, target_type, target_id) WHERE status='open'`
 *   deduplicates in-flight reports (AC-06-14). Once resolved/dismissed a new
 *   open report may be filed.
 * - `target_id` is BIGINT to accommodate both users(id) (int) and
 *   messages(id) (bigint); type narrowing lives in application code via
 *   target_type. In EPIC-04b we add `target_message_id BIGINT REFERENCES
 *   messages(id)` for a proper FK path once messages exists.
 */
export const abuseReports = pgTable(
  'abuse_reports',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    reporterId: integer('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: bigint('target_id', { mode: 'bigint' }).notNull(),
    // EPIC-04b: typed FK to messages for target_type='message'. ON DELETE
    // SET NULL so retention/cascade deletes of a message do not orphan the
    // report row. `target_id` stays authoritative; this column is a
    // typed shortcut for joins.
    targetMessageId: bigint('target_message_id', { mode: 'bigint' }).references(
      () => messages.id,
      { onDelete: 'set null' },
    ),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('open'),
    resolvedBy: integer('resolved_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    targetTypeCheck: check(
      'abuse_reports_target_type_check',
      sql`${table.targetType} IN ('message','user')`,
    ),
    reasonLenCheck: check(
      'abuse_reports_reason_length_check',
      sql`length(${table.reason}) <= 500`,
    ),
    statusCheck: check(
      'abuse_reports_status_check',
      sql`${table.status} IN ('open','resolved','dismissed')`,
    ),
    statusIdx: index('abuse_reports_status_idx').on(
      table.status,
      table.createdAt.desc(),
    ),
    openDedupIdx: uniqueIndex('abuse_reports_open_dedup_idx')
      .on(table.reporterId, table.targetType, table.targetId)
      .where(sql`${table.status} = 'open'`),
    targetIdx: index('abuse_reports_target_idx').on(
      table.targetType,
      table.targetId,
    ),
  }),
);

/**
 * Admin audit log — EPIC-06.
 *
 * `actor_id ON DELETE SET NULL` (AC-06-14): account-deletion cascade must not
 * break historical audit entries; the actor reference is severed but the
 * action record survives for retention-window review.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    actorId: integer('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    actorType: text('actor_type').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: bigint('target_id', { mode: 'bigint' }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    actorTypeCheck: check(
      'audit_log_actor_type_check',
      sql`${table.actorType} IN ('user','admin','system')`,
    ),
    createdIdx: index('audit_log_created_idx').on(table.createdAt.desc()),
    actorIdx: index('audit_log_actor_idx').on(
      table.actorId,
      table.createdAt.desc(),
    ),
    targetIdx: index('audit_log_target_idx').on(
      table.targetType,
      table.targetId,
    ),
  }),
);
