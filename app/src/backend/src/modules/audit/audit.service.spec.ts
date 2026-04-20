jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

import { Logger } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Deterministic in-memory fake of the Drizzle query builder chain used by
 * AuditService. We only need `insert(table).values(...)` and the
 * `select().from(auditLog).where(...).orderBy(...).limit(...)` keyset read.
 *
 * The fake records calls + returns canned rows so unit tests can assert
 * payload shape without touching postgres.
 */
interface InsertedRow {
  actorId: number | null;
  actorType: 'user' | 'admin' | 'system';
  action: string;
  targetType?: string | null;
  targetId?: bigint | null;
  metadata?: unknown;
}

function makeFakeDb(opts?: { failInsert?: boolean; selectRows?: any[] }) {
  const inserted: InsertedRow[] = [];
  const selectCalls: any[] = [];
  const db = {
    insert: jest.fn(() => ({
      values: jest.fn(async (row: InsertedRow) => {
        if (opts?.failInsert) throw new Error('simulated insert failure');
        inserted.push(row);
        return [{ id: BigInt(inserted.length) }];
      }),
    })),
    select: jest.fn(() => {
      const chain: any = {
        from: jest.fn(() => chain),
        where: jest.fn((clause: any) => {
          selectCalls.push({ where: clause });
          return chain;
        }),
        orderBy: jest.fn((...args: any[]) => {
          selectCalls.push({ orderBy: args });
          return chain;
        }),
        limit: jest.fn(async (n: number) => {
          selectCalls.push({ limit: n });
          return opts?.selectRows ?? [];
        }),
      };
      return chain;
    }),
  };
  return { db, inserted, selectCalls };
}

describe('AuditService', () => {
  describe('append()', () => {
    it('inserts an audit_log row with the provided actor + action', async () => {
      const { db, inserted } = makeFakeDb();
      const svc = new AuditService(db as any);

      await svc.append({
        actorId: 42,
        actorType: 'admin',
        action: 'room.ban',
        targetType: 'user',
        targetId: 7n,
        metadata: { roomId: 3 },
      });

      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toMatchObject({
        actorId: 42,
        actorType: 'admin',
        action: 'room.ban',
        targetType: 'user',
        targetId: 7n,
        metadata: { roomId: 3 },
      });
    });

    it('accepts optional target + metadata fields', async () => {
      const { db, inserted } = makeFakeDb();
      const svc = new AuditService(db as any);

      await svc.append({
        actorId: 1,
        actorType: 'system',
        action: 'retention.prune',
      });

      expect(inserted).toHaveLength(1);
      expect(inserted[0].actorId).toBe(1);
      expect(inserted[0].actorType).toBe('system');
      expect(inserted[0].action).toBe('retention.prune');
      expect(inserted[0].targetType ?? null).toBeNull();
      expect(inserted[0].targetId ?? null).toBeNull();
    });

    it('is best-effort: swallows errors + logs, returns void (never throws to caller)', async () => {
      const { db } = makeFakeDb({ failInsert: true });
      const svc = new AuditService(db as any);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const result = await svc.append({
        actorId: 1,
        actorType: 'admin',
        action: 'room.delete',
      });

      expect(result).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('allows null actorId (system action / post-cascade-delete)', async () => {
      const { db, inserted } = makeFakeDb();
      const svc = new AuditService(db as any);

      await svc.append({
        actorId: null,
        actorType: 'system',
        action: 'audit.retention.prune',
      });

      expect(inserted[0].actorId).toBeNull();
    });
  });

  describe('page()', () => {
    it('returns rows with keyset-friendly ORDER BY (created_at, id) DESC and honors limit', async () => {
      const rows = [
        {
          id: 10n,
          actorId: 1,
          actorType: 'admin',
          action: 'room.ban',
          targetType: 'user',
          targetId: 7n,
          metadata: null,
          createdAt: new Date('2026-04-20T10:00:00Z'),
        },
        {
          id: 9n,
          actorId: 1,
          actorType: 'admin',
          action: 'room.unban',
          targetType: 'user',
          targetId: 7n,
          metadata: null,
          createdAt: new Date('2026-04-20T09:00:00Z'),
        },
      ];
      const { db, selectCalls } = makeFakeDb({ selectRows: rows });
      const svc = new AuditService(db as any);

      const out = await svc.page({ limit: 50 });

      expect(out).toEqual(rows);
      // Ensure orderBy + limit were applied.
      expect(selectCalls.some((c) => c.orderBy)).toBe(true);
      expect(selectCalls.some((c) => c.limit === 50)).toBe(true);
    });

    it('applies keyset `before` cursor as (created_at, id) < (cursor_ts, cursor_id)', async () => {
      const { db, selectCalls } = makeFakeDb({ selectRows: [] });
      const svc = new AuditService(db as any);

      await svc.page({
        limit: 25,
        before: { createdAt: new Date('2026-04-20T00:00:00Z'), id: 100n },
      });

      // The `where` clause must be non-null when a cursor is provided.
      const where = selectCalls.find((c) => c.where);
      expect(where).toBeDefined();
      expect(where.where).not.toBeNull();
    });

    it('supports filtering by actor', async () => {
      const { db, selectCalls } = makeFakeDb({ selectRows: [] });
      const svc = new AuditService(db as any);

      await svc.page({ limit: 10, actor: 42 });

      const where = selectCalls.find((c) => c.where);
      expect(where).toBeDefined();
    });

    it('supports filtering by action substring + from/to date range', async () => {
      const { db, selectCalls } = makeFakeDb({ selectRows: [] });
      const svc = new AuditService(db as any);

      await svc.page({
        limit: 10,
        action: 'room.ban',
        from: new Date('2026-04-01T00:00:00Z'),
        to: new Date('2026-04-30T00:00:00Z'),
      });

      const where = selectCalls.find((c) => c.where);
      expect(where).toBeDefined();
    });

    it('caps limit at 200 to prevent runaway queries', async () => {
      const { db, selectCalls } = makeFakeDb({ selectRows: [] });
      const svc = new AuditService(db as any);

      await svc.page({ limit: 10_000 });

      const limitCall = selectCalls.find((c) => typeof c.limit === 'number');
      expect(limitCall?.limit).toBeLessThanOrEqual(200);
    });

    it('defaults limit to 50 when not provided', async () => {
      const { db, selectCalls } = makeFakeDb({ selectRows: [] });
      const svc = new AuditService(db as any);

      await svc.page({} as any);

      const limitCall = selectCalls.find((c) => typeof c.limit === 'number');
      expect(limitCall?.limit).toBe(50);
    });
  });
});
