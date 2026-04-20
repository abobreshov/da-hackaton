/**
 * Tests the Drizzle moderation adapter against an in-memory mock `Db` whose
 * call shape mirrors what `drizzle-orm/node-postgres` exposes. We assert
 * that each port method:
 *
 *   - dispatches the right table (so the adapter can never bind to the
 *     wrong schema object),
 *   - composes the right where clause (room/user/id parts),
 *   - re-throws Postgres errors (specifically `23505`) without translation.
 *
 * Real PG-level behavior (transaction isolation, partial indexes) is the
 * concern of integration tests — this spec only locks the wiring contract.
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
      if (n === 'room_id' || n === 'roomId') return { roomId: val };
      if (n === 'user_id' || n === 'userId') return { userId: val };
      if (n === 'id') return { roomId: val };
      return { [n]: val };
    },
    desc: (x: any) => ({ desc: x?._name }),
    asc: (x: any) => ({ asc: x?._name }),
    sql: Object.assign((..._a: any[]) => ({}), { raw: () => ({}) }),
  };
});

jest.mock('../../database/schema', () => {
  const mkCol = (name: string) => ({ _name: name });
  return {
    roomMemberships: {
      _sym: 'room_memberships',
      name: 'room_memberships',
      roomId: mkCol('room_id'),
      userId: mkCol('user_id'),
      role: mkCol('role'),
    },
    roomBans: {
      _sym: 'room_bans',
      name: 'room_bans',
      roomId: mkCol('room_id'),
      userId: mkCol('user_id'),
      bannedBy: mkCol('banned_by'),
      bannedAt: mkCol('banned_at'),
    },
    rooms: {
      _sym: 'rooms',
      name: 'rooms',
      id: mkCol('id'),
      deletedAt: mkCol('deleted_at'),
    },
  };
});

import { DrizzleModerationRepository } from './moderation.repository';

interface Calls {
  selects: Array<{ table: string; where: any; orderBy?: any; limit?: number }>;
  inserts: Array<{ table: string; values: any }>;
  deletes: Array<{ table: string; where: any }>;
  updates: Array<{ table: string; set: any; where: any }>;
  txRan: boolean;
}

function makeDb(rowsByTable: Record<string, any[]> = {}, opts: { insertThrows?: any } = {}) {
  const calls: Calls = {
    selects: [],
    inserts: [],
    deletes: [],
    updates: [],
    txRan: false,
  };

  const buildSelect = (): any => {
    let table = '';
    let where: any = null;
    let orderByVal: any = undefined;
    const chain: any = {
      from: jest.fn((t: any) => {
        table = t?._sym ?? String(t);
        return chain;
      }),
      where: jest.fn((w: any) => {
        where = w;
        return chain;
      }),
      orderBy: jest.fn((o: any) => {
        orderByVal = o;
        return chain;
      }),
      limit: jest.fn(async (n: number) => {
        calls.selects.push({ table, where, orderBy: orderByVal, limit: n });
        return rowsByTable[table] ?? [];
      }),
      // thenable for .where().orderBy() awaits without limit
      then: (ok: any, err: any) => {
        calls.selects.push({ table, where, orderBy: orderByVal });
        return Promise.resolve(rowsByTable[table] ?? []).then(ok, err);
      },
    };
    return chain;
  };

  const buildInsert = (table: string) => ({
    values: jest.fn(async (vals: any) => {
      calls.inserts.push({ table, values: vals });
      if (opts.insertThrows) throw opts.insertThrows;
      return [{}];
    }),
  });

  const buildDelete = (table: string) => ({
    where: jest.fn(async (w: any) => {
      calls.deletes.push({ table, where: w });
      return [{}];
    }),
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
    delete: jest.fn((t: any) => buildDelete(t?._sym ?? String(t))),
    update: jest.fn((t: any) => buildUpdate(t?._sym ?? String(t))),
    transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => {
      calls.txRan = true;
      return cb(db);
    }),
  };
  return { db, calls };
}

describe('DrizzleModerationRepository', () => {
  it('roleOf() selects from room_memberships filtered by (roomId, userId) and returns role', async () => {
    const { db, calls } = makeDb({
      room_memberships: [{ roomId: 1, userId: 30, role: 'admin' }],
    });
    const repo = new DrizzleModerationRepository(db);

    const role = await repo.roleOf(1, 30);

    expect(role).toBe('admin');
    expect(calls.selects).toHaveLength(1);
    expect(calls.selects[0]).toMatchObject({
      table: 'room_memberships',
      where: { roomId: 1, userId: 30 },
      limit: 1,
    });
  });

  it('roleOf() returns null when there is no membership row', async () => {
    const { db } = makeDb({ room_memberships: [] });
    const repo = new DrizzleModerationRepository(db);
    const role = await repo.roleOf(1, 99);
    expect(role).toBeNull();
  });

  it('banMember() runs a transaction: inserts room_bans + deletes room_memberships', async () => {
    const { db, calls } = makeDb();
    const repo = new DrizzleModerationRepository(db);

    await repo.banMember({ roomId: 1, userId: 30, bannedBy: 20 });

    expect(calls.txRan).toBe(true);
    expect(calls.inserts).toEqual([
      { table: 'room_bans', values: { roomId: 1, userId: 30, bannedBy: 20 } },
    ]);
    expect(calls.deletes).toHaveLength(1);
    expect(calls.deletes[0]).toMatchObject({
      table: 'room_memberships',
      where: { roomId: 1, userId: 30 },
    });
  });

  it('banMember() re-throws unique-violation (23505) unchanged', async () => {
    const err: any = new Error('duplicate key');
    err.code = '23505';
    const { db } = makeDb({}, { insertThrows: err });
    const repo = new DrizzleModerationRepository(db);

    await expect(repo.banMember({ roomId: 1, userId: 30, bannedBy: 20 })).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('unbanMember() deletes from room_bans by (roomId, userId)', async () => {
    const { db, calls } = makeDb();
    const repo = new DrizzleModerationRepository(db);

    await repo.unbanMember(1, 30);

    expect(calls.deletes).toHaveLength(1);
    expect(calls.deletes[0]).toMatchObject({
      table: 'room_bans',
      where: { roomId: 1, userId: 30 },
    });
  });

  it('listBans() selects from room_bans where roomId=? ordered by bannedAt DESC', async () => {
    const ban = { roomId: 1, userId: 30, bannedBy: 20, bannedAt: new Date() };
    const { db, calls } = makeDb({ room_bans: [ban] });
    const repo = new DrizzleModerationRepository(db);

    const rows = await repo.listBans(1);

    expect(rows).toEqual([ban]);
    expect(calls.selects[0]).toMatchObject({
      table: 'room_bans',
      where: { roomId: 1 },
    });
    expect(calls.selects[0].orderBy).toBeDefined();
  });

  it('promoteMember() updates role=admin on room_memberships', async () => {
    const { db, calls } = makeDb();
    const repo = new DrizzleModerationRepository(db);

    await repo.promoteMember(1, 30);

    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]).toMatchObject({
      table: 'room_memberships',
      set: { role: 'admin' },
      where: { roomId: 1, userId: 30 },
    });
  });

  it('demoteMember() updates role=member on room_memberships', async () => {
    const { db, calls } = makeDb();
    const repo = new DrizzleModerationRepository(db);

    await repo.demoteMember(1, 20);

    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]).toMatchObject({
      table: 'room_memberships',
      set: { role: 'member' },
      where: { roomId: 1, userId: 20 },
    });
  });

  it('deleteRoom() updates rooms.deletedAt by id', async () => {
    const { db, calls } = makeDb();
    const repo = new DrizzleModerationRepository(db);
    const ts = new Date('2026-04-20T12:00:00Z');

    await repo.deleteRoom(1, ts);

    expect(calls.updates).toEqual([
      {
        table: 'rooms',
        set: { deletedAt: ts },
        where: { roomId: 1 },
      },
    ]);
  });
});
