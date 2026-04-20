jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { ModerationService } from './moderation.service';

/**
 * In-memory fake Drizzle. Models just the subset of behavior we need:
 *   - `roomMemberships` rows keyed by (roomId, userId) with role
 *   - `room_bans` rows keyed by (roomId, userId)
 *   - `rooms.deletedAt`
 *
 * The service uses `db.transaction(async (tx) => ...)` for multi-row
 * atomic flows; the fake runs the body inline against a shared state
 * object so we can assert row-level side effects deterministically.
 */
interface FakeState {
  memberships: Map<string, { roomId: number; userId: number; role: 'owner' | 'admin' | 'member'; joinedAt: Date }>;
  bans: Map<string, { roomId: number; userId: number; bannedBy: number; bannedAt: Date }>;
  rooms: Map<number, { id: number; ownerId: number; deletedAt: Date | null }>;
  auditCalls: any[];
}

function key(roomId: number, userId: number): string {
  return `${roomId}:${userId}`;
}

function makeDb(state: FakeState) {
  // Trivial chainable query builder that dispatches on intent via tagged calls.
  // For unit tests we only use it to read roomMemberships + bans + rooms.
  const select = jest.fn((columns?: any) => {
    let currentTable: 'room_memberships' | 'room_bans' | 'rooms' | null = null;
    let whereClause: { kind: string; roomId?: number; userId?: number } | null = null;
    const chain: any = {
      from: jest.fn((table: any) => {
        const name: string = table?._sym ?? table?.name ?? String(table);
        if (name.includes('room_memberships') || name === 'roomMemberships') currentTable = 'room_memberships';
        else if (name.includes('room_bans') || name === 'roomBans') currentTable = 'room_bans';
        else if (name.includes('rooms') || name === 'rooms') currentTable = 'rooms';
        return chain;
      }),
      where: jest.fn((clause: any) => {
        whereClause = clause;
        return chain;
      }),
      limit: jest.fn(async (_n: number) => {
        return resolveQuery(state, currentTable, whereClause, columns);
      }),
      orderBy: jest.fn(() => awaitable),
      then: undefined,
    };
    chain[Symbol.asyncIterator] = undefined;
    const awaitable: any = new Proxy(chain, {
      get(target, prop) {
        if (prop === 'then') {
          return (onFulfilled: any, onRejected: any) => {
            try {
              const rows = resolveQuery(state, currentTable, whereClause, columns);
              return Promise.resolve(rows).then(onFulfilled, onRejected);
            } catch (e) {
              return Promise.reject(e).then(onFulfilled, onRejected);
            }
          };
        }
        return (target as any)[prop];
      },
    });
    return awaitable;
  });

  const insert = jest.fn((table: any) => {
    const name: string = table?._sym ?? table?.name ?? String(table);
    return {
      values: jest.fn(async (row: any) => {
        if (name.includes('room_bans') || name === 'roomBans') {
          const k = key(row.roomId, row.userId);
          if (state.bans.has(k)) {
            const err: any = new Error('duplicate key value violates unique constraint "room_bans_pkey"');
            err.code = '23505';
            throw err;
          }
          state.bans.set(k, { ...row, bannedAt: row.bannedAt ?? new Date() });
        } else if (name.includes('audit_log') || name === 'auditLog') {
          state.auditCalls.push({ via: 'tx', ...row });
        }
        return [{}];
      }),
    };
  });

  const del = jest.fn((table: any) => {
    const name: string = table?._sym ?? table?.name ?? String(table);
    return {
      where: jest.fn(async (clause: any) => {
        // clause shape is { kind: 'and', roomId, userId } via our fake and()
        const { roomId, userId } = clause ?? {};
        if (name.includes('room_bans') || name === 'roomBans') {
          const k = key(roomId!, userId!);
          const existed = state.bans.delete(k);
          return [{ deleted: existed ? 1 : 0 }];
        }
        if (name.includes('room_memberships') || name === 'roomMemberships') {
          const k = key(roomId!, userId!);
          state.memberships.delete(k);
          return [{}];
        }
        return [{}];
      }),
    };
  });

  const update = jest.fn((table: any) => {
    const name: string = table?._sym ?? table?.name ?? String(table);
    return {
      set: jest.fn((vals: any) => ({
        where: jest.fn(async (clause: any) => {
          if (name.includes('room_memberships') || name === 'roomMemberships') {
            const { roomId, userId } = clause ?? {};
            const k = key(roomId!, userId!);
            const m = state.memberships.get(k);
            if (m && vals.role) m.role = vals.role;
          } else if (name.includes('rooms') || name === 'rooms') {
            const { roomId } = clause ?? {};
            const r = state.rooms.get(roomId!);
            if (r && 'deletedAt' in vals) r.deletedAt = vals.deletedAt;
          }
          return [{}];
        }),
      })),
    };
  });

  const db: any = {
    select,
    insert,
    delete: del,
    update,
    transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => {
      // tx uses the same implementations so side-effects apply to shared state
      return cb(db);
    }),
  };
  return db;
}

// Helper: resolve a query against fake state using structured where clause.
function resolveQuery(
  state: FakeState,
  table: 'room_memberships' | 'room_bans' | 'rooms' | null,
  where: any,
  columns: any,
): any[] {
  if (!table) return [];
  if (table === 'room_memberships') {
    const arr = [...state.memberships.values()];
    if (where?.roomId !== undefined && where?.userId !== undefined) {
      return arr.filter((r) => r.roomId === where.roomId && r.userId === where.userId);
    }
    if (where?.roomId !== undefined) {
      return arr.filter((r) => r.roomId === where.roomId);
    }
    return arr;
  }
  if (table === 'room_bans') {
    const arr = [...state.bans.values()];
    if (where?.roomId !== undefined && where?.userId !== undefined) {
      return arr.filter((r) => r.roomId === where.roomId && r.userId === where.userId);
    }
    if (where?.roomId !== undefined) {
      return arr.filter((r) => r.roomId === where.roomId);
    }
    return arr;
  }
  if (table === 'rooms') {
    const arr = [...state.rooms.values()];
    if (where?.roomId !== undefined) {
      return arr.filter((r) => r.id === where.roomId);
    }
    return arr;
  }
  return [];
}

// ---- Mock drizzle-orm helpers + schema to capture structured clauses ----
jest.mock('drizzle-orm', () => {
  return {
    and: (...parts: any[]) => {
      const merged: any = { kind: 'and' };
      for (const p of parts) {
        if (p && typeof p === 'object') Object.assign(merged, p);
      }
      return merged;
    },
    eq: (col: any, val: any) => {
      const colName: string = col?._name ?? String(col);
      if (colName.includes('room_id') || colName === 'roomId') return { roomId: val };
      if (colName.includes('user_id') || colName === 'userId') return { userId: val };
      if (colName === 'id' || colName.endsWith('.id')) return { roomId: val };
      return { [colName]: val };
    },
    sql: Object.assign((..._args: any[]) => ({}), { raw: () => ({}) }),
    desc: (x: any) => x,
    asc: (x: any) => x,
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
      joinedAt: mkCol('joined_at'),
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
      ownerId: mkCol('owner_id'),
      deletedAt: mkCol('deleted_at'),
    },
    auditLog: {
      _sym: 'audit_log',
      name: 'audit_log',
    },
    users: {
      _sym: 'users',
      name: 'users',
      id: mkCol('id'),
      name_col: mkCol('name'),
    },
  };
});

function seed(): FakeState {
  return {
    memberships: new Map([
      [key(1, 10), { roomId: 1, userId: 10, role: 'owner',  joinedAt: new Date() }],
      [key(1, 20), { roomId: 1, userId: 20, role: 'admin',  joinedAt: new Date() }],
      [key(1, 30), { roomId: 1, userId: 30, role: 'member', joinedAt: new Date() }],
      [key(1, 40), { roomId: 1, userId: 40, role: 'member', joinedAt: new Date() }],
    ]),
    bans: new Map(),
    rooms: new Map([[1, { id: 1, ownerId: 10, deletedAt: null }]]),
    auditCalls: [],
  };
}

describe('ModerationService', () => {
  describe('banMember()', () => {
    it('admin bans a member: inserts room_bans + audit_log in same transaction + removes membership', async () => {
      const state = seed();
      const db = makeDb(state);
      const audit = { append: jest.fn() };
      const svc = new ModerationService(db, audit as any);

      await svc.banMember({ roomId: 1, adminId: 20, userId: 30 });

      expect(state.bans.has(key(1, 30))).toBe(true);
      expect(state.memberships.has(key(1, 30))).toBe(false);
      // audit row written inside the tx (state.auditCalls) OR via
      // auditService.append(...) post-commit — service must do one.
      const appendedInTx = state.auditCalls.some((c) => c.action === 'room.ban');
      const appendedAfter = (audit.append as jest.Mock).mock.calls.some(
        ([p]: any[]) => p?.action === 'room.ban',
      );
      expect(appendedInTx || appendedAfter).toBe(true);
    });

    it('member cannot ban (FORBIDDEN)', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new ModerationService(db, { append: jest.fn() } as any);

      await expect(
        svc.banMember({ roomId: 1, adminId: 30, userId: 40 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('cannot ban the owner', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new ModerationService(db, { append: jest.fn() } as any);

      await expect(
        svc.banMember({ roomId: 1, adminId: 20, userId: 10 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses to ban a non-member (NOT_FOUND)', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new ModerationService(db, { append: jest.fn() } as any);

      await expect(
        svc.banMember({ roomId: 1, adminId: 20, userId: 99 }),
      ).rejects.toThrow(HttpException);
    });

    it('maps 23505 from ban insert to 409 CONFLICT via wire() (lines 16-18, 114-117)', async () => {
      const state = seed();
      // Pre-populate a ban so the transactional insert re-collides.
      state.bans.set(
        `1:30`,
        { roomId: 1, userId: 30, bannedBy: 20, bannedAt: new Date() },
      );
      const db = makeDb(state);
      const svc = new ModerationService(db, { append: jest.fn() } as any);

      await expect(
        svc.banMember({ roomId: 1, adminId: 20, userId: 30 }),
      ).rejects.toMatchObject({
        getStatus: expect.any(Function),
      });
      // Double-check by inspecting the thrown HttpException body.
      try {
        await svc.banMember({ roomId: 1, adminId: 20, userId: 30 });
      } catch (e: any) {
        expect(e).toBeInstanceOf(HttpException);
        expect(e.getStatus()).toBe(409);
        const body = e.getResponse();
        expect(body).toMatchObject({
          code: expect.any(String),
          message: expect.stringContaining('already banned'),
        });
      }
    });

    it('re-throws non-23505 errors from the ban transaction', async () => {
      const state = seed();
      const db = makeDb(state);
      // Monkey-patch db.transaction to throw a non-unique error.
      db.transaction = jest.fn(async () => {
        const err: any = new Error('pg down');
        throw err;
      });
      const svc = new ModerationService(db, { append: jest.fn() } as any);
      await expect(
        svc.banMember({ roomId: 1, adminId: 20, userId: 30 }),
      ).rejects.toThrow('pg down');
    });
  });

  describe('unbanMember()', () => {
    it('admin unbans a previously banned user + writes audit', async () => {
      const state = seed();
      state.bans.set(key(1, 30), { roomId: 1, userId: 30, bannedBy: 20, bannedAt: new Date() });
      const db = makeDb(state);
      const audit = { append: jest.fn() };
      const svc = new ModerationService(db, audit as any);

      await svc.unbanMember({ roomId: 1, adminId: 20, userId: 30 });

      expect(state.bans.has(key(1, 30))).toBe(false);
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'room.unban', actorId: 20 }),
      );
    });

    it('member cannot unban', async () => {
      const state = seed();
      state.bans.set(key(1, 30), { roomId: 1, userId: 30, bannedBy: 20, bannedAt: new Date() });
      const db = makeDb(state);
      const svc = new ModerationService(db, { append: jest.fn() } as any);

      await expect(
        svc.unbanMember({ roomId: 1, adminId: 40, userId: 30 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listBans()', () => {
    it('returns bans for a room (admin access)', async () => {
      const state = seed();
      state.bans.set(key(1, 30), { roomId: 1, userId: 30, bannedBy: 20, bannedAt: new Date('2026-04-20T00:00:00Z') });
      state.bans.set(key(1, 40), { roomId: 1, userId: 40, bannedBy: 20, bannedAt: new Date('2026-04-20T01:00:00Z') });
      const db = makeDb(state);
      const svc = new ModerationService(db, { append: jest.fn() } as any);

      const bans = await svc.listBans({ roomId: 1, viewerId: 20 });

      expect(bans).toHaveLength(2);
      expect(bans.every((b: any) => b.roomId === 1)).toBe(true);
    });

    it('non-member cannot view ban list', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new ModerationService(db, { append: jest.fn() } as any);

      await expect(
        svc.listBans({ roomId: 1, viewerId: 999 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('promote() / demote()', () => {
    it('owner promotes a member to admin + writes audit', async () => {
      const state = seed();
      const db = makeDb(state);
      const audit = { append: jest.fn() };
      const svc = new ModerationService(db, audit as any);

      await svc.promote({ roomId: 1, actorId: 10, userId: 30 });

      expect(state.memberships.get(key(1, 30))?.role).toBe('admin');
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'room.role.promote' }),
      );
    });

    it('non-owner cannot promote', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new ModerationService(db, { append: jest.fn() } as any);

      await expect(
        svc.promote({ roomId: 1, actorId: 20, userId: 30 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('owner demotes an admin to member + writes audit', async () => {
      const state = seed();
      const db = makeDb(state);
      const audit = { append: jest.fn() };
      const svc = new ModerationService(db, audit as any);

      await svc.demote({ roomId: 1, actorId: 10, userId: 20 });

      expect(state.memberships.get(key(1, 20))?.role).toBe('member');
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'room.role.demote' }),
      );
    });

    it('owner cannot demote themself (AC-06-02)', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new ModerationService(db, { append: jest.fn() } as any);

      await expect(
        svc.demote({ roomId: 1, actorId: 10, userId: 10 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('promote is idempotent when target is already admin (line 166)', async () => {
      const state = seed();
      const db = makeDb(state);
      const audit = { append: jest.fn() };
      const svc = new ModerationService(db, audit as any);

      // userId=20 is already admin; promoting should be a no-op.
      await svc.promote({ roomId: 1, actorId: 10, userId: 20 });
      expect(state.memberships.get(`1:20`)?.role).toBe('admin');
      expect(audit.append).not.toHaveBeenCalled();
    });

    it('promote refuses to promote non-member (NotFound line 164)', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new ModerationService(db, { append: jest.fn() } as any);
      await expect(
        svc.promote({ roomId: 1, actorId: 10, userId: 999 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('promote forbidden when target is the owner (line 165)', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new ModerationService(db, { append: jest.fn() } as any);
      await expect(
        svc.promote({ roomId: 1, actorId: 10, userId: 10 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('demote is idempotent when target is already member (line 194)', async () => {
      const state = seed();
      const db = makeDb(state);
      const audit = { append: jest.fn() };
      const svc = new ModerationService(db, audit as any);

      // userId=30 is a member; demoting should be a no-op.
      await svc.demote({ roomId: 1, actorId: 10, userId: 30 });
      expect(state.memberships.get(`1:30`)?.role).toBe('member');
      expect(audit.append).not.toHaveBeenCalled();
    });

    it('demote refuses to demote non-member (NotFound line 192)', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new ModerationService(db, { append: jest.fn() } as any);
      await expect(
        svc.demote({ roomId: 1, actorId: 10, userId: 999 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('demote forbidden when target is the owner (line 193)', async () => {
      const state = seed();
      // Second owner (shouldn't exist at SQL level, but the guard exists)
      state.memberships.set(`1:50`, { roomId: 1, userId: 50, role: 'owner', joinedAt: new Date() });
      const db = makeDb(state);
      const svc = new ModerationService(db, { append: jest.fn() } as any);
      await expect(
        svc.demote({ roomId: 1, actorId: 10, userId: 50 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteRoom()', () => {
    it('owner soft-deletes room + writes audit', async () => {
      const state = seed();
      const db = makeDb(state);
      const audit = { append: jest.fn() };
      const svc = new ModerationService(db, audit as any);

      await svc.deleteRoom({ roomId: 1, actorId: 10 });

      expect(state.rooms.get(1)?.deletedAt).not.toBeNull();
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'room.delete', actorId: 10 }),
      );
    });

    it('admin (not owner) cannot delete room', async () => {
      const state = seed();
      const db = makeDb(state);
      const svc = new ModerationService(db, { append: jest.fn() } as any);

      await expect(
        svc.deleteRoom({ roomId: 1, actorId: 20 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
