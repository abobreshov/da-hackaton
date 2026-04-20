/**
 * Tests the Drizzle abuse-reports adapter against an in-memory mock `Db`.
 * Asserts table dispatch + where-clause shape + cursor passthrough so the
 * adapter can never silently bind to the wrong column.
 *
 * Real PG-level behavior (partial UNIQUE on status='open') is the concern
 * of integration tests; this spec only locks the wiring contract.
 */

jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

jest.mock('drizzle-orm', () => {
  return {
    and: (...parts: any[]) => {
      const merged: any = { kind: 'and' };
      for (const p of parts) if (p && typeof p === 'object') Object.assign(merged, p);
      return merged;
    },
    eq: (col: any, val: any) => {
      const n: string = col?._name ?? String(col);
      if (n === 'id') return { id: val };
      if (n === 'status') return { status: val };
      if (n === 'created_at') return { createdAt: val };
      return { [n]: val };
    },
    lt: (_col: any, val: any) => ({ before: val }),
    or: (...parts: any[]) => Object.assign({}, ...parts),
    desc: (x: any) => ({ desc: x?._name }),
    asc: (x: any) => ({ asc: x?._name }),
    sql: Object.assign((..._a: any[]) => ({}), { raw: () => ({}) }),
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
    users: {
      _sym: 'users',
      name: 'users',
      id: mkCol('id'),
      role: mkCol('role'),
    },
  };
});

import { DrizzleAbuseReportsRepository } from './abuse-reports.repository';

interface Calls {
  selects: Array<{ table: string; where: any; limit?: number }>;
  inserts: Array<{ table: string; values: any; returning?: boolean }>;
  updates: Array<{ table: string; set: any; where: any }>;
}

function makeDb(rowsByTable: Record<string, any[]> = {}, opts: { insertThrows?: any } = {}) {
  const calls: Calls = { selects: [], inserts: [], updates: [] };

  const buildSelect = () => {
    let table = '';
    let where: any = null;
    const chain: any = {
      from: jest.fn((t: any) => {
        table = t?._sym ?? String(t);
        return chain;
      }),
      where: jest.fn((w: any) => {
        where = w;
        return chain;
      }),
      orderBy: jest.fn(() => chain),
      limit: jest.fn(async (n: number) => {
        calls.selects.push({ table, where, limit: n });
        return rowsByTable[table] ?? [];
      }),
    };
    return chain;
  };

  const buildInsert = (table: string) => ({
    values: jest.fn((vals: any) => ({
      returning: jest.fn(async () => {
        calls.inserts.push({ table, values: vals, returning: true });
        if (opts.insertThrows) throw opts.insertThrows;
        return [{ id: 1n, ...vals, status: 'open', resolvedBy: null, resolvedAt: null, createdAt: new Date() }];
      }),
    })),
  });

  const buildUpdate = (table: string) => ({
    set: jest.fn((s: any) => ({
      where: jest.fn(async (w: any) => {
        calls.updates.push({ table, set: s, where: w });
        return [{}];
      }),
    })),
  });

  const db: any = {
    select: jest.fn(() => buildSelect()),
    insert: jest.fn((t: any) => buildInsert(t?._sym ?? String(t))),
    update: jest.fn((t: any) => buildUpdate(t?._sym ?? String(t))),
  };
  return { db, calls };
}

describe('DrizzleAbuseReportsRepository', () => {
  it('insert() writes to abuse_reports + uses .returning()', async () => {
    const { db, calls } = makeDb();
    const repo = new DrizzleAbuseReportsRepository(db);

    const row = await repo.insert({
      reporterId: 2,
      targetType: 'user',
      targetId: 3n,
      reason: 'spam',
    });

    expect(row.id).toBe(1n);
    expect(calls.inserts).toEqual([
      {
        table: 'abuse_reports',
        values: { reporterId: 2, targetType: 'user', targetId: 3n, reason: 'spam' },
        returning: true,
      },
    ]);
  });

  it('insert() re-throws unique-violation (23505) unchanged', async () => {
    const err: any = new Error('duplicate');
    err.code = '23505';
    const { db } = makeDb({}, { insertThrows: err });
    const repo = new DrizzleAbuseReportsRepository(db);

    await expect(
      repo.insert({ reporterId: 2, targetType: 'user', targetId: 3n, reason: 'r' }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('findUserById() selects users by id with limit 1', async () => {
    const { db, calls } = makeDb({ users: [{ id: 1, role: 'ADMIN' }] });
    const repo = new DrizzleAbuseReportsRepository(db);

    const u = await repo.findUserById(1);

    expect(u).toEqual({ id: 1, role: 'ADMIN' });
    expect(calls.selects[0]).toMatchObject({
      table: 'users',
      where: { id: 1 },
      limit: 1,
    });
  });

  it('findUserById() returns null when no row', async () => {
    const { db } = makeDb({ users: [] });
    const repo = new DrizzleAbuseReportsRepository(db);
    const u = await repo.findUserById(99);
    expect(u).toBeNull();
  });

  it('listOpen() filters by status=open and applies the supplied limit', async () => {
    const sample = { id: 1n, status: 'open' };
    const { db, calls } = makeDb({ abuse_reports: [sample] });
    const repo = new DrizzleAbuseReportsRepository(db);

    const rows = await repo.listOpen({ limit: 25 });

    expect(rows).toEqual([sample]);
    expect(calls.selects[0]).toMatchObject({
      table: 'abuse_reports',
      limit: 25,
    });
    expect(calls.selects[0].where).toMatchObject({ status: 'open' });
  });

  it('listOpen() includes the keyset cursor in the where clause when supplied', async () => {
    const { db, calls } = makeDb({ abuse_reports: [] });
    const repo = new DrizzleAbuseReportsRepository(db);
    const before = { createdAt: new Date('2026-04-20T10:00:00Z'), id: 999n };

    await repo.listOpen({ limit: 50, before });

    // `or(lt(...), and(...))` in the adapter merges the two keyset clauses.
    // The mock's `or` collapses both lt calls into the same `before` key;
    // what we care about is (a) status=open filter still present, (b) a
    // cursor-derived "before" entry was appended to the clause.
    expect(calls.selects[0].where).toMatchObject({ status: 'open' });
    expect(calls.selects[0].where.before).toBeDefined();
  });

  it('findById() selects abuse_reports by id with limit 1', async () => {
    const sample = { id: 7n };
    const { db, calls } = makeDb({ abuse_reports: [sample] });
    const repo = new DrizzleAbuseReportsRepository(db);

    const row = await repo.findById(7n);
    expect(row).toEqual(sample);
    expect(calls.selects[0]).toMatchObject({
      table: 'abuse_reports',
      where: { id: 7n },
      limit: 1,
    });
  });

  it('updateStatus() updates abuse_reports with status + resolver fields by id', async () => {
    const { db, calls } = makeDb();
    const repo = new DrizzleAbuseReportsRepository(db);
    const ts = new Date('2026-04-20T12:00:00Z');

    await repo.updateStatus(7n, 'resolved', 1, ts);

    expect(calls.updates).toEqual([
      {
        table: 'abuse_reports',
        set: { status: 'resolved', resolvedBy: 1, resolvedAt: ts },
        where: { id: 7n },
      },
    ]);
  });
});
