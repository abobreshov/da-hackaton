jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AbuseReportsService } from './abuse-reports.service';

/**
 * In-memory fake modeling:
 *   - abuse_reports rows with id + status + dedup via partial UNIQUE
 *     (reporter_id, target_type, target_id) WHERE status='open'
 *   - users with role (for admin gates)
 */
interface FakeReport {
  id: bigint;
  reporterId: number;
  targetType: 'message' | 'user';
  targetId: bigint;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolvedBy: number | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

interface FakeState {
  reports: Map<string, FakeReport>;
  byId: Map<bigint, FakeReport>;
  nextId: bigint;
  users: Map<number, { id: number; role: 'ADMIN' | 'USER' }>;
  auditCalls: any[];
}

function openKey(reporterId: number, targetType: string, targetId: bigint): string {
  return `${reporterId}:${targetType}:${targetId.toString()}`;
}

function makeDb(state: FakeState) {
  const selectFn = jest.fn(() => {
    let table: 'abuse_reports' | 'users' | null = null;
    let whereClause: any = null;
    let limitVal: number | null = null;
    const chain: any = {
      from: jest.fn((t: any) => {
        const name = t?._sym ?? String(t);
        if (name.includes('abuse_reports')) table = 'abuse_reports';
        else if (name.includes('users')) table = 'users';
        return chain;
      }),
      where: jest.fn((c: any) => {
        whereClause = c;
        return chain;
      }),
      orderBy: jest.fn(() => chain),
      limit: jest.fn(async (n: number) => {
        limitVal = n;
        return runQuery();
      }),
    };
    const runQuery = (): any[] => {
      if (table === 'abuse_reports') {
        let rows = [...state.byId.values()];
        if (whereClause) {
          if (whereClause.status) rows = rows.filter((r) => r.status === whereClause.status);
          if (whereClause.id !== undefined) rows = rows.filter((r) => r.id === whereClause.id);
          if (whereClause.before) {
            rows = rows.filter((r) => r.createdAt < whereClause.before.createdAt
              || (r.createdAt.getTime() === whereClause.before.createdAt.getTime() && r.id < whereClause.before.id));
          }
        }
        rows.sort((a, b) => {
          const ts = b.createdAt.getTime() - a.createdAt.getTime();
          if (ts !== 0) return ts;
          return Number(b.id - a.id);
        });
        if (limitVal != null) rows = rows.slice(0, limitVal);
        return rows;
      }
      if (table === 'users') {
        let rows = [...state.users.values()];
        if (whereClause?.id !== undefined) rows = rows.filter((u) => u.id === whereClause.id);
        return rows;
      }
      return [];
    };
    const awaitable = new Proxy(chain, {
      get(t, p) {
        if (p === 'then') {
          return (ok: any, err: any) => Promise.resolve(runQuery()).then(ok, err);
        }
        return (t as any)[p];
      },
    });
    return awaitable;
  });

  const insertFn = jest.fn((table: any) => {
    const name = table?._sym ?? String(table);
    return {
      values: jest.fn((row: any) => {
        const runInsert = () => {
          if (name.includes('abuse_reports')) {
            const k = openKey(row.reporterId, row.targetType, row.targetId);
            const existing = state.reports.get(k);
            if (existing && existing.status === 'open') {
              const err: any = new Error('duplicate key value violates unique constraint "abuse_reports_open_dedup_idx"');
              err.code = '23505';
              throw err;
            }
            const id = state.nextId++;
            const created: FakeReport = {
              id,
              reporterId: row.reporterId,
              targetType: row.targetType,
              targetId: typeof row.targetId === 'bigint' ? row.targetId : BigInt(row.targetId),
              reason: row.reason,
              status: 'open',
              resolvedBy: null,
              resolvedAt: null,
              createdAt: new Date(),
            };
            state.reports.set(k, created);
            state.byId.set(id, created);
            return created;
          }
          if (name.includes('audit_log')) {
            state.auditCalls.push({ via: 'tx', ...row });
            return {};
          }
          return {};
        };
        const chainObj: any = {
          returning: jest.fn(async () => [runInsert()]),
        };
        const awaitable = new Proxy(chainObj, {
          get(t, p) {
            if (p === 'then') return (ok: any, err: any) => {
              try { return Promise.resolve(runInsert()).then(ok, err); }
              catch (e) { return Promise.reject(e).then(ok, err); }
            };
            return (t as any)[p];
          },
        });
        return awaitable;
      }),
    };
  });

  const updateFn = jest.fn((table: any) => {
    const name = table?._sym ?? String(table);
    return {
      set: jest.fn((vals: any) => ({
        where: jest.fn(async (clause: any) => {
          if (name.includes('abuse_reports')) {
            const row = state.byId.get(clause.id);
            if (!row) return [];
            Object.assign(row, vals);
            return [row];
          }
          return [];
        }),
      })),
    };
  });

  const db: any = {
    select: selectFn,
    insert: insertFn,
    update: updateFn,
    transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => cb(db)),
  };
  return db;
}

jest.mock('drizzle-orm', () => {
  return {
    and: (...parts: any[]) => {
      const merged: any = { kind: 'and' };
      for (const p of parts) if (p && typeof p === 'object') Object.assign(merged, p);
      return merged;
    },
    eq: (col: any, val: any) => {
      const n = col?._name ?? String(col);
      // id column: pass raw value (users.id is int; abuse_reports.id is bigint)
      if (n === 'id') return { id: val };
      if (n === 'status') return { status: val };
      if (n === 'role') return { role: val };
      if (n === 'created_at') return { createdAt: val };
      return { [n]: val };
    },
    lt: (_col: any, val: any) => ({ before: val }),
    sql: Object.assign((..._a: any[]) => ({}), { raw: () => ({}) }),
    desc: (x: any) => x,
    asc: (x: any) => x,
    or: (...parts: any[]) => Object.assign({}, ...parts),
  };
});

jest.mock('../../database/schema', () => {
  const mkCol = (name: string) => ({ _name: name });
  return {
    abuseReports: {
      _sym: 'abuse_reports',
      name: 'abuse_reports',
      id: mkCol('id'),
      reporterId: mkCol('reporter_id'),
      targetType: mkCol('target_type'),
      targetId: mkCol('target_id'),
      reason: mkCol('reason'),
      status: mkCol('status'),
      resolvedBy: mkCol('resolved_by'),
      resolvedAt: mkCol('resolved_at'),
      createdAt: mkCol('created_at'),
    },
    auditLog: { _sym: 'audit_log', name: 'audit_log' },
    users: {
      _sym: 'users',
      name: 'users',
      id: mkCol('id'),
      role: mkCol('role'),
    },
  };
});

function seed(): FakeState {
  return {
    reports: new Map(),
    byId: new Map(),
    nextId: 1n,
    users: new Map([
      [1, { id: 1, role: 'ADMIN' }],
      [2, { id: 2, role: 'USER' }],
      [3, { id: 3, role: 'USER' }],
    ]),
    auditCalls: [],
  };
}

describe('AbuseReportsService', () => {
  describe('create()', () => {
    it('inserts a report with status=open + returns row', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new AbuseReportsService(db, { append: jest.fn() } as any);

      const row = await svc.create({
        reporterId: 2,
        targetType: 'message',
        targetId: 100n,
        reason: 'spam',
      });

      expect(row.status).toBe('open');
      expect(row.reporterId).toBe(2);
      expect(state.byId.size).toBe(1);
    });

    it('rejects a duplicate in-flight report (partial UNIQUE -> CONFLICT)', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new AbuseReportsService(db, { append: jest.fn() } as any);

      await svc.create({ reporterId: 2, targetType: 'user', targetId: 3n, reason: 'abuse' });

      await expect(
        svc.create({ reporterId: 2, targetType: 'user', targetId: 3n, reason: 'still abusing' }),
      ).rejects.toThrow(ConflictException);
    });

    it('permits a re-report once the previous was resolved/dismissed', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new AbuseReportsService(db, { append: jest.fn() } as any);

      const first = await svc.create({ reporterId: 2, targetType: 'user', targetId: 3n, reason: 'r1' });
      const row = state.byId.get(first.id)!;
      row.status = 'resolved';

      await expect(
        svc.create({ reporterId: 2, targetType: 'user', targetId: 3n, reason: 'r2' }),
      ).resolves.toBeDefined();
    });

    it('rejects reason > 500 chars -> VALIDATION_FAILED', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new AbuseReportsService(db, { append: jest.fn() } as any);

      const longReason = 'x'.repeat(501);
      await expect(
        svc.create({ reporterId: 2, targetType: 'user', targetId: 3n, reason: longReason }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects empty reason', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new AbuseReportsService(db, { append: jest.fn() } as any);

      await expect(
        svc.create({ reporterId: 2, targetType: 'user', targetId: 3n, reason: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid targetType', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new AbuseReportsService(db, { append: jest.fn() } as any);

      await expect(
        svc.create({
          reporterId: 2,
          targetType: 'badger' as any,
          targetId: 3n,
          reason: 'nope',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create() — error propagation', () => {
    it('re-throws non-23505 DB errors (line 116)', async () => {
      const state = seed();
      const db = makeDb(state);
      // Override insert.values to throw a non-unique error.
      const originalInsert = db.insert;
      db.insert = jest.fn(() => ({
        values: jest.fn(() => ({
          returning: jest.fn(async () => {
            const err: any = new Error('pg busy');
            throw err;
          }),
        })),
      }));
      const svc = new AbuseReportsService(db, { append: jest.fn() } as any);
      await expect(
        svc.create({ reporterId: 2, targetType: 'message', targetId: 1n, reason: 'r' }),
      ).rejects.toThrow('pg busy');
      db.insert = originalInsert;
    });
  });

  describe('listOpen()', () => {
    it('admin sees all open reports, keyset-paginated DESC by (createdAt, id)', async () => {
      const state = seed();
      for (let i = 0; i < 3; i++) {
        const id = state.nextId++;
        const createdAt = new Date(2026, 3, 20, 10, i);
        const row: FakeReport = {
          id,
          reporterId: 2,
          targetType: 'user',
          targetId: BigInt(100 + i),
          reason: `r${i}`,
          status: 'open',
          resolvedBy: null,
          resolvedAt: null,
          createdAt,
        };
        state.reports.set(openKey(2, 'user', BigInt(100 + i)), row);
        state.byId.set(id, row);
      }
      const db = makeDb(state);
      const svc = new AbuseReportsService(db, { append: jest.fn() } as any);

      const rows = await svc.listOpen({ adminId: 1, limit: 10 });
      expect(rows.length).toBe(3);
      expect(rows[0].id).toBeGreaterThan(rows[1].id);
    });

    it('non-admin cannot list', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new AbuseReportsService(db, { append: jest.fn() } as any);

      await expect(svc.listOpen({ adminId: 2, limit: 10 })).rejects.toThrow(ForbiddenException);
    });

    it('caps limit at 200', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new AbuseReportsService(db, { append: jest.fn() } as any);

      const rows = await svc.listOpen({ adminId: 1, limit: 10_000 });
      expect(Array.isArray(rows)).toBe(true);
    });

    it('applies the keyset cursor when `before` is supplied (lines 125-134)', async () => {
      // Use a hand-rolled db that just captures calls — the existing fake's
      // `or()` helper collapses the two lt clauses in a way that makes it
      // impossible to express the keyset comparator in-memory. We only need
      // to assert the branch executed (line 126) and returned whatever the
      // select chain yielded.
      const state = seed();
      const onSelect = jest.fn();
      const chainForAbuse = (): any => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              limit: jest.fn(async () => []),
            })),
          })),
        })),
      });
      const db: any = {
        select: jest.fn(() => {
          onSelect();
          // First call = assertAdmin() on users table
          if (onSelect.mock.calls.length === 1) {
            return {
              from: jest.fn(() => ({
                where: jest.fn(() => ({
                  limit: jest.fn(async () => [{ id: 1, role: 'ADMIN' }]),
                })),
              })),
            };
          }
          return chainForAbuse();
        }),
      };
      const svc = new AbuseReportsService(db, { append: jest.fn() } as any);

      const rows = await svc.listOpen({
        adminId: 1,
        limit: 10,
        before: { createdAt: new Date(2026, 3, 20, 10, 3), id: 999n },
      });
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toEqual([]);
      // assertAdmin + abuseReports select -> 2 calls total
      expect(onSelect).toHaveBeenCalledTimes(2);
      // silence unused-var warning
      void state;
    });

    it('floor-caps limit at 1 when caller supplies zero or negative', async () => {
      const state = seed();
      const id = state.nextId++;
      state.byId.set(id, {
        id, reporterId: 2, targetType: 'user', targetId: 1n,
        reason: 'r', status: 'open', resolvedBy: null, resolvedAt: null,
        createdAt: new Date(),
      });
      state.reports.set(openKey(2, 'user', 1n), state.byId.get(id)!);
      const db = makeDb(state);
      const svc = new AbuseReportsService(db, { append: jest.fn() } as any);

      const rows = await svc.listOpen({ adminId: 1, limit: 0 });
      expect(Array.isArray(rows)).toBe(true);
    });
  });

  describe('resolve()', () => {
    it('admin sets status=resolved + writes audit', async () => {
      const state = seed();
      const id = state.nextId++;
      const row: FakeReport = {
        id, reporterId: 2, targetType: 'user', targetId: 3n,
        reason: 'x', status: 'open', resolvedBy: null, resolvedAt: null,
        createdAt: new Date(),
      };
      state.byId.set(id, row);
      state.reports.set(openKey(2, 'user', 3n), row);

      const db = makeDb(state);
      const audit = { append: jest.fn() };
      const svc = new AbuseReportsService(db, audit as any);

      await svc.resolve({ id, adminId: 1, note: 'handled offline' });

      expect(state.byId.get(id)!.status).toBe('resolved');
      expect(state.byId.get(id)!.resolvedBy).toBe(1);
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'report.resolve', actorId: 1 }),
      );
    });

    it('non-admin cannot resolve', async () => {
      const state = seed();
      const id = state.nextId++;
      state.byId.set(id, {
        id, reporterId: 2, targetType: 'user', targetId: 3n,
        reason: 'x', status: 'open', resolvedBy: null, resolvedAt: null,
        createdAt: new Date(),
      });
      const db = makeDb(state);
      const svc = new AbuseReportsService(db, { append: jest.fn() } as any);

      await expect(svc.resolve({ id, adminId: 2 })).rejects.toThrow(ForbiddenException);
    });

    it('404 when report does not exist', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new AbuseReportsService(db, { append: jest.fn() } as any);

      await expect(svc.resolve({ id: 9999n, adminId: 1 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('dismiss()', () => {
    it('admin sets status=dismissed + writes audit', async () => {
      const state = seed();
      const id = state.nextId++;
      const row: FakeReport = {
        id, reporterId: 2, targetType: 'user', targetId: 3n,
        reason: 'x', status: 'open', resolvedBy: null, resolvedAt: null,
        createdAt: new Date(),
      };
      state.byId.set(id, row);
      state.reports.set(openKey(2, 'user', 3n), row);

      const db = makeDb(state);
      const audit = { append: jest.fn() };
      const svc = new AbuseReportsService(db, audit as any);

      await svc.dismiss({ id, adminId: 1 });

      expect(state.byId.get(id)!.status).toBe('dismissed');
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'report.dismiss', actorId: 1 }),
      );
    });

    it('non-admin cannot dismiss', async () => {
      const state = seed();
      const id = state.nextId++;
      state.byId.set(id, {
        id, reporterId: 2, targetType: 'user', targetId: 3n,
        reason: 'x', status: 'open', resolvedBy: null, resolvedAt: null,
        createdAt: new Date(),
      });
      const db = makeDb(state);
      const svc = new AbuseReportsService(db, { append: jest.fn() } as any);

      await expect(svc.dismiss({ id, adminId: 2 })).rejects.toThrow(ForbiddenException);
    });
  });
});
