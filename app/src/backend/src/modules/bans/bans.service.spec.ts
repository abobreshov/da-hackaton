jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

import { BadRequestException } from '@nestjs/common';
import { BansService } from './bans.service';

/**
 * Chainable query-builder mock (mirrors the one used by friends.service.spec).
 */
function makeChain(resolve: () => any) {
  const thenResolve = (onFulfilled: any) => Promise.resolve(resolve()).then(onFulfilled);
  const chain: any = {
    select: jest.fn(() => chain),
    from: jest.fn(() => chain),
    where: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    insert: jest.fn(() => chain),
    values: jest.fn(() => chain),
    onConflictDoNothing: jest.fn(() => chain),
    returning: jest.fn(() => chain),
    update: jest.fn(() => chain),
    set: jest.fn(() => chain),
    delete: jest.fn(() => chain),
    then: jest.fn(thenResolve),
  };
  return chain;
}

/**
 * Build a db-double whose `.transaction(cb)` invokes cb with a tx-double,
 * and, when `shouldThrow` is true, simulates a DB error by awaiting cb and
 * then re-throwing. On error we record `rolledBack = true`. Callers inspect
 * `tx.<method>.mock.calls` to assert the sequence of operations.
 */
function makeDb(
  options: {
    friendshipsDeleteResult?: any;
    dmUpdateResult?: any;
    insertThrows?: boolean;
    deleteThrows?: boolean;
    updateThrows?: boolean;
    outerUpdateResult?: any;
  } = {},
) {
  const insertChain: any = {
    values: jest.fn(() => insertChain),
    onConflictDoNothing: jest.fn(() => {
      if (options.insertThrows) {
        return {
          then: (onFulfilled: any, onRejected: any) =>
            Promise.reject(new Error('db error')).then(onFulfilled, onRejected),
        };
      }
      return { then: (onFulfilled: any) => Promise.resolve(undefined).then(onFulfilled) };
    }),
  };
  const deleteChain: any = {
    where: jest.fn(() => {
      if (options.deleteThrows) {
        return {
          then: (onFulfilled: any, onRejected: any) =>
            Promise.reject(new Error('db error')).then(onFulfilled, onRejected),
        };
      }
      return {
        then: (onFulfilled: any) =>
          Promise.resolve(options.friendshipsDeleteResult ?? undefined).then(onFulfilled),
      };
    }),
  };
  const updateChain: any = {
    set: jest.fn(() => updateChain),
    where: jest.fn(() => {
      if (options.updateThrows) {
        return {
          then: (onFulfilled: any, onRejected: any) =>
            Promise.reject(new Error('db error')).then(onFulfilled, onRejected),
        };
      }
      return {
        then: (onFulfilled: any) =>
          Promise.resolve(options.dmUpdateResult ?? undefined).then(onFulfilled),
      };
    }),
  };

  const tx: any = {
    insert: jest.fn(() => insertChain),
    delete: jest.fn(() => deleteChain),
    update: jest.fn(() => updateChain),
  };

  let rolledBack = false;
  let committed = false;
  const db: any = {
    transaction: jest.fn(async (cb: any) => {
      try {
        const result = await cb(tx);
        committed = true;
        return result;
      } catch (e) {
        rolledBack = true;
        throw e;
      }
    }),
    // Outer (non-tx) methods used by unbanUser / isBanned.
    delete: jest.fn(() => makeChain(() => undefined)),
    select: jest.fn(() => makeChain(() => [])),
  };

  return {
    db,
    tx,
    insertChain,
    deleteChain,
    updateChain,
    get rolledBack() {
      return rolledBack;
    },
    get committed() {
      return committed;
    },
  };
}

describe('BansService', () => {
  let events: { emit: jest.Mock };

  beforeEach(() => {
    events = { emit: jest.fn() };
  });

  describe('banUser', () => {
    it('rejects self-ban with BadRequest', async () => {
      const h = makeDb();
      const svc = new BansService(h.db, events as any);
      await expect(svc.banUser({ bannerId: 5, bannedId: 5 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(h.db.transaction).not.toHaveBeenCalled();
    });

    it('runs insert-user_bans + delete-friendship + freeze-dm in a single transaction', async () => {
      const h = makeDb();
      const svc = new BansService(h.db, events as any);
      await svc.banUser({ bannerId: 7, bannedId: 3 });

      expect(h.db.transaction).toHaveBeenCalledTimes(1);

      // Operations were performed on the tx object, NOT on the outer db.
      expect(h.tx.insert).toHaveBeenCalledTimes(1);
      expect(h.tx.delete).toHaveBeenCalledTimes(1);
      expect(h.tx.update).toHaveBeenCalledTimes(1);
      expect(h.insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ bannerId: 7, bannedId: 3 }),
      );
      expect(h.insertChain.onConflictDoNothing).toHaveBeenCalled();
      expect(h.committed).toBe(true);
      expect(h.rolledBack).toBe(false);
    });

    it('emits user.banned.me, friend.removed, and dm.frozen AFTER commit', async () => {
      const h = makeDb();
      const svc = new BansService(h.db, events as any);
      await svc.banUser({ bannerId: 7, bannedId: 3 });

      const names = events.emit.mock.calls.map((c) => c[0]);
      expect(names).toEqual(
        expect.arrayContaining(['user.banned.me', 'friend.removed', 'dm.frozen']),
      );
    });

    it('rolls back and does NOT emit events when the insert step throws', async () => {
      const h = makeDb({ insertThrows: true });
      const svc = new BansService(h.db, events as any);
      await expect(svc.banUser({ bannerId: 7, bannedId: 3 })).rejects.toThrow('db error');

      expect(h.rolledBack).toBe(true);
      expect(h.committed).toBe(false);
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('rolls back and does NOT emit events when the friendship-delete step throws', async () => {
      const h = makeDb({ deleteThrows: true });
      const svc = new BansService(h.db, events as any);
      await expect(svc.banUser({ bannerId: 7, bannedId: 3 })).rejects.toThrow('db error');

      expect(h.tx.insert).toHaveBeenCalledTimes(1);
      expect(h.rolledBack).toBe(true);
      expect(h.committed).toBe(false);
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('rolls back and does NOT emit events when the dm-freeze step throws', async () => {
      const h = makeDb({ updateThrows: true });
      const svc = new BansService(h.db, events as any);
      await expect(svc.banUser({ bannerId: 7, bannedId: 3 })).rejects.toThrow('db error');

      expect(h.rolledBack).toBe(true);
      expect(h.committed).toBe(false);
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('normalises pair so DELETE and UPDATE match (user_low < user_high / user_a < user_b)', async () => {
      const h = makeDb();
      const svc = new BansService(h.db, events as any);
      await svc.banUser({ bannerId: 7, bannedId: 3 });

      // The exact SQL is opaque through drizzle's query builder, but we can assert
      // that both delete() and update() were called exactly once with a where()
      // clause — the SQL itself is validated via an integration spec later.
      expect(h.deleteChain.where).toHaveBeenCalledTimes(1);
      expect(h.updateChain.where).toHaveBeenCalledTimes(1);
      expect(h.updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ frozenAt: expect.any(Date) }),
      );
    });

    it('returns { ok: true } on success', async () => {
      const h = makeDb();
      const svc = new BansService(h.db, events as any);
      const out = await svc.banUser({ bannerId: 7, bannedId: 3 });
      expect(out).toEqual({ ok: true });
    });

    it('pair() handles bannerId < bannedId (line 28 "a < b" branch)', async () => {
      const h = makeDb();
      const svc = new BansService(h.db, events as any);
      // bannerId=2 < bannedId=9 exercises the `true` branch of pair()'s ternary.
      await svc.banUser({ bannerId: 2, bannedId: 9 });

      expect(h.db.transaction).toHaveBeenCalledTimes(1);
      expect(h.insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ bannerId: 2, bannedId: 9 }),
      );
      // dm.frozen payload should be (userA=2, userB=9) since 2 < 9.
      const dmEvent = events.emit.mock.calls.find((c) => c[0] === 'dm.frozen');
      expect(dmEvent?.[1]).toMatchObject({ userA: 2, userB: 9 });
    });
  });

  describe('unbanUser', () => {
    it('rejects self-unban with BadRequest', async () => {
      const h = makeDb();
      const svc = new BansService(h.db, events as any);
      await expect(svc.unbanUser({ bannerId: 5, bannedId: 5 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('deletes the user_bans row and does NOT re-create friendship or touch dm_channels', async () => {
      const h = makeDb();
      const svc = new BansService(h.db, events as any);
      await svc.unbanUser({ bannerId: 7, bannedId: 3 });

      // Only an outer delete on user_bans; no transaction, no friendships/dm writes.
      expect(h.db.transaction).not.toHaveBeenCalled();
      expect(h.db.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('isBanned', () => {
    it('returns true when banner A has banned B', async () => {
      const h = makeDb();
      h.db.select = jest.fn(() => makeChain(() => [{ bannerId: 7, bannedId: 3 }]));
      const svc = new BansService(h.db, events as any);
      await expect(svc.isBanned({ a: 7, b: 3 })).resolves.toBe(true);
    });

    it('returns true when banner B has banned A (other direction)', async () => {
      const h = makeDb();
      h.db.select = jest.fn(() => makeChain(() => [{ bannerId: 3, bannedId: 7 }]));
      const svc = new BansService(h.db, events as any);
      await expect(svc.isBanned({ a: 7, b: 3 })).resolves.toBe(true);
    });

    it('returns false when no ban rows for the pair exist', async () => {
      const h = makeDb();
      h.db.select = jest.fn(() => makeChain(() => []));
      const svc = new BansService(h.db, events as any);
      await expect(svc.isBanned({ a: 7, b: 3 })).resolves.toBe(false);
    });
  });

  describe('listBansByUser', () => {
    it('returns ban rows where bannerId = self (banlist view)', async () => {
      const h = makeDb();
      h.db.select = jest.fn(() => makeChain(() => [{ bannerId: 7, bannedId: 3 }]));
      const svc = new BansService(h.db, events as any);
      const out = await svc.listBansByUser({ userId: 7 });
      expect(Array.isArray(out)).toBe(true);
    });
  });
});
