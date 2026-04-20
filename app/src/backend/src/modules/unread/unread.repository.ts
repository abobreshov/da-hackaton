import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import {
  CountSinceInput,
  DmUnread,
  MarkReadInput,
  RoomUnread,
  UNREAD_CAP,
  UnreadRepositoryPort,
} from './unread.types';

/**
 * Drizzle adapter for UnreadRepositoryPort (EPIC-09).
 *
 * Upsert targets the functional UNIQUE index
 * `user_last_read_scope_idx (user_id, COALESCE(room_id,0), COALESCE(dm_id,0))`
 * so a single row exists per (user, scope). Count queries scan
 * `messages.id > COALESCE(last_read_id, 0)` in the same scope and cap at 99.
 *
 * Drizzle's fluent builder cannot express `ON CONFLICT` on a functional
 * index — use raw `execute(sql\`...\`)` for the upsert + counts.
 */
@Injectable()
export class DrizzleUnreadRepository implements UnreadRepositoryPort {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async upsertLastRead(input: MarkReadInput): Promise<void> {
    const roomId = input.roomId ?? null;
    const dmId = input.dmId ?? null;
    await (this.db as any).execute(sql`
      INSERT INTO user_last_read (user_id, room_id, dm_id, last_read_id, last_read_at)
      VALUES (${input.userId}, ${roomId}, ${dmId}, ${input.lastReadId}, NOW())
      ON CONFLICT (user_id, COALESCE(room_id, 0), COALESCE(dm_id, 0))
      DO UPDATE SET
        last_read_id = EXCLUDED.last_read_id,
        last_read_at = NOW()
    `);
  }

  async unreadRoomsFor(userId: number): Promise<RoomUnread[]> {
    // Rooms the user is a member of; count unread per room with the 99 cap
    // applied in SQL (LEAST). LEFT JOIN user_last_read so rooms without a
    // marker row still get counted against last_read_id = 0.
    const rows: Array<{ roomId: number; count: number | string }> = await executeRows(
      this.db,
      sql`
          SELECT
            rm.room_id AS "roomId",
            LEAST(
              (
                SELECT COUNT(*)
                  FROM messages m
                 WHERE m.room_id = rm.room_id
                   AND m.deleted_at IS NULL
                   AND m.id > COALESCE(ulr.last_read_id, 0)
              ),
              ${UNREAD_CAP}
            )::int AS "count"
            FROM room_memberships rm
            LEFT JOIN user_last_read ulr
              ON ulr.user_id = rm.user_id
             AND ulr.room_id = rm.room_id
           WHERE rm.user_id = ${userId}
        `,
    );

    return rows.map((r) => ({
      roomId: r.roomId,
      count: toInt(r.count),
    }));
  }

  async unreadDmsFor(userId: number): Promise<DmUnread[]> {
    const rows: Array<{
      dmId: number;
      peerUserId: number;
      count: number | string;
    }> = await executeRows(
      this.db,
      sql`
          SELECT
            dc.id AS "dmId",
            CASE WHEN dc.user_low = ${userId} THEN dc.user_high ELSE dc.user_low END AS "peerUserId",
            LEAST(
              (
                SELECT COUNT(*)
                  FROM messages m
                 WHERE m.dm_id = dc.id
                   AND m.deleted_at IS NULL
                   AND m.author_id <> ${userId}
                   AND m.id > COALESCE(ulr.last_read_id, 0)
              ),
              ${UNREAD_CAP}
            )::int AS "count"
            FROM dm_channels dc
            LEFT JOIN user_last_read ulr
              ON ulr.user_id = ${userId}
             AND ulr.dm_id = dc.id
           WHERE dc.user_low = ${userId} OR dc.user_high = ${userId}
        `,
    );

    return rows.map((r) => ({
      dmId: r.dmId,
      peerUserId: r.peerUserId,
      count: toInt(r.count),
    }));
  }

  async countSince(input: CountSinceInput): Promise<number> {
    if (input.roomId != null) {
      const rows: Array<{ count: number | string }> = await executeRows(
        this.db,
        sql`
          SELECT LEAST(
            (
              SELECT COUNT(*)
                FROM messages m
                LEFT JOIN user_last_read ulr
                  ON ulr.user_id = ${input.userId}
                 AND ulr.room_id = m.room_id
               WHERE m.room_id = ${input.roomId}
                 AND m.deleted_at IS NULL
                 AND m.id > COALESCE(ulr.last_read_id, 0)
            ),
            ${UNREAD_CAP}
          )::int AS "count"
        `,
      );
      return toInt(rows[0]?.count ?? 0);
    }
    if (input.dmId != null) {
      const rows: Array<{ count: number | string }> = await executeRows(
        this.db,
        sql`
          SELECT LEAST(
            (
              SELECT COUNT(*)
                FROM messages m
                LEFT JOIN user_last_read ulr
                  ON ulr.user_id = ${input.userId}
                 AND ulr.dm_id = m.dm_id
               WHERE m.dm_id = ${input.dmId}
                 AND m.deleted_at IS NULL
                 AND m.author_id <> ${input.userId}
                 AND m.id > COALESCE(ulr.last_read_id, 0)
            ),
            ${UNREAD_CAP}
          )::int AS "count"
        `,
      );
      return toInt(rows[0]?.count ?? 0);
    }
    return 0;
  }
}

async function executeRows<T>(db: Db, query: any): Promise<T[]> {
  const res = await (db as any).execute(query);
  if (Array.isArray(res)) return res as T[];
  if (res && Array.isArray(res.rows)) return res.rows as T[];
  return [];
}

function toInt(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number.parseInt(v, 10);
  if (typeof v === 'bigint') return Number(v);
  return 0;
}
