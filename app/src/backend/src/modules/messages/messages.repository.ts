import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { dmChannels, messages } from '../../database/schema';
import {
  DmChannelRow,
  InsertMessageInput,
  ListMessagesInput,
  MessageRow,
  MessagesRepositoryPort,
  SinceMessagesInput,
} from './messages.types';

/**
 * Drizzle adapter for MessagesRepositoryPort.
 *
 * Row-shape helpers at the bottom normalise Drizzle's `bigint` string vs
 * bigint inconsistency — our schema declares `{ mode: 'bigint' }` so reads
 * come back as native bigint; inserts accept bigint too.
 */
@Injectable()
export class DrizzleMessagesRepository implements MessagesRepositoryPort {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async upsertDmChannel(a: number, b: number): Promise<DmChannelRow> {
    const [low, high] = a < b ? [a, b] : [b, a];
    // AC-07-16 — "DO UPDATE SET id=id RETURNING id" trick gets us the id back
    // regardless of whether this is an insert or a hit on the existing pair.
    const rows = await (this.db as any)
      .insert(dmChannels)
      .values({ userLow: low, userHigh: high })
      .onConflictDoUpdate({
        target: [dmChannels.userLow, dmChannels.userHigh],
        set: { userLow: sql`${dmChannels.userLow}` },
      })
      .returning();
    return rows[0] as DmChannelRow;
  }

  async findDmChannel(a: number, b: number): Promise<DmChannelRow | null> {
    const [low, high] = a < b ? [a, b] : [b, a];
    const rows = await (this.db as any)
      .select()
      .from(dmChannels)
      .where(and(eq(dmChannels.userLow, low), eq(dmChannels.userHigh, high)))
      .limit(1);
    return (rows[0] as DmChannelRow) ?? null;
  }

  async insertMessageIfDmNotFrozen(input: InsertMessageInput): Promise<MessageRow | null> {
    if (input.dmId == null) {
      throw new Error('insertMessageIfDmNotFrozen requires dmId');
    }
    // AC-07-19 — atomic frozen-guard insert. Express via a raw SQL CTE since
    // Drizzle's fluent builder does not support `INSERT ... SELECT ... WHERE
    // NOT EXISTS ...` out of the box. The NOT EXISTS checks the DM channel's
    // current frozen_at at row-insert time, closing the race between a
    // read-then-write eligibility check and a ban transaction.
    const body = input.body;
    const replyTo = input.replyTo ?? null;
    const rows: MessageRow[] = await (this.db as any).execute(sql`
      INSERT INTO messages (dm_id, author_id, body, reply_to)
      SELECT ${input.dmId}, ${input.authorId}, ${body}, ${replyTo}
      WHERE NOT EXISTS (
        SELECT 1 FROM dm_channels
         WHERE id = ${input.dmId}
           AND frozen_at IS NOT NULL
      )
      RETURNING id, room_id AS "roomId", dm_id AS "dmId",
                author_id AS "authorId", body, reply_to AS "replyTo",
                edited_at AS "editedAt", deleted_at AS "deletedAt",
                created_at AS "createdAt"
    `);
    const first = extractFirst(rows);
    return first ? normaliseRow(first) : null;
  }

  async insertMessage(input: InsertMessageInput): Promise<MessageRow> {
    const [row] = await (this.db as any)
      .insert(messages)
      .values({
        roomId: input.roomId,
        dmId: input.dmId,
        authorId: input.authorId,
        body: input.body,
        replyTo: input.replyTo ?? null,
      })
      .returning();
    return normaliseRow(row);
  }

  async findMessageById(id: bigint): Promise<MessageRow | null> {
    const rows = await (this.db as any).select().from(messages).where(eq(messages.id, id)).limit(1);
    return rows[0] ? normaliseRow(rows[0]) : null;
  }

  async softDeleteMessage(id: bigint): Promise<MessageRow | null> {
    const rows = await (this.db as any)
      .update(messages)
      .set({ deletedAt: new Date() })
      .where(and(eq(messages.id, id), isNull(messages.deletedAt)))
      .returning();
    return rows[0] ? normaliseRow(rows[0]) : null;
  }

  async updateMessageBody(id: bigint, body: string): Promise<MessageRow | null> {
    const rows = await (this.db as any)
      .update(messages)
      .set({ body, editedAt: new Date() })
      .where(and(eq(messages.id, id), isNull(messages.deletedAt)))
      .returning();
    return rows[0] ? normaliseRow(rows[0]) : null;
  }

  async listMessages(input: ListMessagesInput): Promise<MessageRow[]> {
    // Composite cursor (AC-07-20). Index:
    //   (room_id|dm_id, created_at DESC, id DESC) WHERE deleted_at IS NULL
    const scope =
      input.roomId != null
        ? eq(messages.roomId, input.roomId)
        : eq(messages.dmId, input.dmId as number);

    const cursorGate = input.before
      ? sql`(${messages.createdAt}, ${messages.id}) < (${input.before.createdAt}, ${input.before.id})`
      : sql`TRUE`;

    const rows = await (this.db as any)
      .select()
      .from(messages)
      .where(and(scope, isNull(messages.deletedAt), cursorGate))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(input.limit);
    return rows.map(normaliseRow);
  }

  async listMessagesSince(input: SinceMessagesInput): Promise<MessageRow[]> {
    const scope =
      input.roomId != null
        ? eq(messages.roomId, input.roomId)
        : eq(messages.dmId, input.dmId as number);

    const rows = await (this.db as any)
      .select()
      .from(messages)
      .where(and(scope, isNull(messages.deletedAt), gt(messages.id, input.lastSeenId)))
      .orderBy(asc(messages.id))
      .limit(input.limit);
    return rows.map(normaliseRow);
  }
}

// ---------------------------------------------------------------------------

/**
 * `execute(sql\`...\`)` returns either an array (node-pg `QueryResult.rows`
 * style) or an object with `{ rows }` depending on the driver. Guard both.
 */
function extractFirst<T>(ret: any): T | null {
  if (!ret) return null;
  if (Array.isArray(ret)) return (ret[0] as T) ?? null;
  if (Array.isArray(ret.rows)) return (ret.rows[0] as T) ?? null;
  return null;
}

/**
 * Drizzle may return `id` as string when mode: 'bigint' is in effect under
 * certain driver paths (raw `execute` with column aliases, pg defaults).
 * Normalise to native bigint so the service layer has a stable type.
 */
function normaliseRow(row: any): MessageRow {
  return {
    id: toBigInt(row.id),
    roomId: row.roomId ?? row.room_id ?? null,
    dmId: row.dmId ?? row.dm_id ?? null,
    authorId: row.authorId ?? row.author_id,
    body: row.body,
    replyTo:
      row.replyTo != null
        ? toBigInt(row.replyTo)
        : row.reply_to != null
          ? toBigInt(row.reply_to)
          : null,
    editedAt: row.editedAt ?? row.edited_at ?? null,
    deletedAt: row.deletedAt ?? row.deleted_at ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
  };
}

function toBigInt(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string') return BigInt(v);
  throw new Error(`cannot coerce ${typeof v} to bigint`);
}
