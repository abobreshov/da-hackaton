import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, lt, lte, or, sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { auditLog } from '../../database/schema';

export type ActorType = 'user' | 'admin' | 'system';

export interface AuditAppendInput {
  actorId: number | null;
  actorType: ActorType;
  action: string;
  targetType?: string | null;
  targetId?: bigint | null;
  metadata?: unknown;
}

export interface AuditKeysetCursor {
  createdAt: Date;
  id: bigint;
}

export interface AuditPageInput {
  limit?: number;
  before?: AuditKeysetCursor;
  actor?: number;
  action?: string;
  from?: Date;
  to?: Date;
}

export interface AuditRow {
  id: bigint;
  actorId: number | null;
  actorType: ActorType;
  action: string;
  targetType: string | null;
  targetId: bigint | null;
  metadata: unknown;
  createdAt: Date;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * AuditService — EPIC-06.
 *
 * Writes are best-effort: if append() fails, the error is logged and
 * swallowed — the caller's privileged action must not be blocked by an
 * audit write failure (AC-06 risk note).
 *
 * `page()` is keyset-paginated on (created_at, id) DESC to match
 * `audit_log_created_idx`.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async append(input: AuditAppendInput): Promise<void> {
    try {
      await (this.db as any).insert(auditLog).values({
        actorId: input.actorId,
        actorType: input.actorType,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: (input.metadata ?? null) as any,
      });
    } catch (err) {
      this.logger.warn(
        `audit.append failed action=${input.action} actor=${input.actorId} err=${(err as Error).message}`,
      );
      // Intentionally do not rethrow — audit is best-effort.
    }
  }

  async page(input: AuditPageInput): Promise<AuditRow[]> {
    const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const filters: any[] = [];
    if (input.actor !== undefined) {
      filters.push(eq(auditLog.actorId, input.actor));
    }
    if (input.action) {
      filters.push(eq(auditLog.action, input.action));
    }
    if (input.from) {
      filters.push(gt(auditLog.createdAt, input.from));
    }
    if (input.to) {
      filters.push(lte(auditLog.createdAt, input.to));
    }
    if (input.before) {
      // Keyset: (createdAt, id) < (cursor.createdAt, cursor.id)
      filters.push(
        or(
          lt(auditLog.createdAt, input.before.createdAt),
          and(eq(auditLog.createdAt, input.before.createdAt), lt(auditLog.id, input.before.id)),
        ),
      );
    }

    const where = filters.length ? and(...filters) : null;

    const q = (this.db as any)
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(limit);

    const rows = await q;
    return rows as AuditRow[];
  }
}
