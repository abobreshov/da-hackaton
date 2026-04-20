jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FriendsService } from './friends.service';

/**
 * Chainable query builder mock. Every method returns `this` and the terminal
 * call returns whatever `resolve` yields. Good enough for unit-testing that
 * the service invokes the right sequence of drizzle calls without spinning
 * up Postgres.
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
    returning: jest.fn(() => chain),
    update: jest.fn(() => chain),
    set: jest.fn(() => chain),
    delete: jest.fn(() => chain),
    orderBy: jest.fn(() => chain),
    then: jest.fn(thenResolve),
  };
  return chain;
}

describe('FriendsService', () => {
  let events: { emit: jest.Mock };

  beforeEach(() => {
    events = { emit: jest.fn() };
  });

  describe('request', () => {
    it('resolves target by username, normalises (user_a < user_b), and inserts pending row', async () => {
      // requesterId=7, target (id=3, name='alice') -> user_a=3, user_b=7, requested_by=7
      const userRows = [{ id: 3, name: 'alice' }];
      const existingFriendship: any[] = [];
      const existingBan: any[] = [];
      const inserted = [{ id: 42 }];

      const chains: any[] = [];
      const next = (resolve: () => any) => {
        const c = makeChain(resolve);
        chains.push(c);
        return c;
      };

      const db: any = {
        select: jest.fn(() => next(() => userRows).select(undefined)),
        insert: jest.fn(() => next(() => inserted).insert(undefined)),
      };
      // More declarative — re-wire manually so first select returns user row,
      // second select checks existing friendship, third select checks ban.
      let selectCalls = 0;
      db.select = jest.fn(() => {
        selectCalls += 1;
        if (selectCalls === 1) return makeChain(() => userRows);
        if (selectCalls === 2) return makeChain(() => existingFriendship);
        return makeChain(() => existingBan);
      });
      const insertChain = makeChain(() => inserted);
      db.insert = jest.fn(() => insertChain);

      const svc = new FriendsService(db, events as any);
      const result = await svc.request({
        requesterId: 7,
        targetUsername: 'alice',
        text: 'hi there',
      });

      expect(db.insert).toHaveBeenCalledTimes(1);
      const valuesArg = insertChain.values.mock.calls[0][0];
      expect(valuesArg.userA).toBe(3);
      expect(valuesArg.userB).toBe(7);
      expect(valuesArg.status).toBe('pending');
      expect(valuesArg.requestedBy).toBe(7);
      expect(valuesArg.requestText).toBe('hi there');
      expect(result).toEqual({ id: 42 });
      expect(events.emit).toHaveBeenCalledWith(
        'friend.request.new',
        expect.objectContaining({ fromUserId: 7, toUserId: 3 }),
      );
    });

    it('rejects self-friend with BadRequest', async () => {
      const userRows = [{ id: 5, name: 'me' }];
      const db: any = { select: jest.fn(() => makeChain(() => userRows)), insert: jest.fn() };
      const svc = new FriendsService(db, events as any);
      await expect(svc.request({ requesterId: 5, targetUsername: 'me' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('throws NotFound when target username does not exist', async () => {
      const db: any = { select: jest.fn(() => makeChain(() => [])), insert: jest.fn() };
      const svc = new FriendsService(db, events as any);
      await expect(svc.request({ requesterId: 1, targetUsername: 'ghost' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws Conflict when a friendship (pending or accepted) already exists', async () => {
      const userRows = [{ id: 3, name: 'alice' }];
      const existing = [{ id: 99, status: 'pending' }];
      let selectCalls = 0;
      const db: any = {
        select: jest.fn(() => {
          selectCalls += 1;
          if (selectCalls === 1) return makeChain(() => userRows);
          return makeChain(() => existing);
        }),
        insert: jest.fn(),
      };
      const svc = new FriendsService(db, events as any);
      await expect(svc.request({ requesterId: 7, targetUsername: 'alice' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('throws Conflict with "already friends" message when status is accepted (line 88 branch)', async () => {
      const userRows = [{ id: 3, name: 'alice' }];
      const existing = [{ id: 99, status: 'accepted' }];
      let calls = 0;
      const db: any = {
        select: jest.fn(() => {
          calls += 1;
          return makeChain(() => (calls === 1 ? userRows : existing));
        }),
        insert: jest.fn(),
      };
      const svc = new FriendsService(db, events as any);
      try {
        await svc.request({ requesterId: 7, targetUsername: 'alice' });
        fail('should throw');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ConflictException);
        expect(String(e.message || e.getResponse?.())).toMatch(/already friends/);
      }
    });

    it('exercises pair() a < b branch when requesterId < targetId (line 44)', async () => {
      const userRows = [{ id: 9, name: 'bob' }];
      const noFriend: any[] = [];
      const noBan: any[] = [];
      const inserted = [{ id: 101 }];
      let calls = 0;
      const insertChain = makeChain(() => inserted);
      const db: any = {
        select: jest.fn(() => {
          calls += 1;
          if (calls === 1) return makeChain(() => userRows);
          if (calls === 2) return makeChain(() => noFriend);
          return makeChain(() => noBan);
        }),
        insert: jest.fn(() => insertChain),
      };
      const svc = new FriendsService(db, events as any);
      // requesterId=2 < targetId=9 -> pair() returns (low=2, high=9)
      await svc.request({ requesterId: 2, targetUsername: 'bob' });
      const values = insertChain.values.mock.calls[0][0];
      expect(values.userA).toBe(2);
      expect(values.userB).toBe(9);
    });

    it('throws Conflict when either side has banned the other', async () => {
      const userRows = [{ id: 3, name: 'alice' }];
      const noFriend: any[] = [];
      const existingBan = [{ bannerId: 3, bannedId: 7 }];
      let selectCalls = 0;
      const db: any = {
        select: jest.fn(() => {
          selectCalls += 1;
          if (selectCalls === 1) return makeChain(() => userRows);
          if (selectCalls === 2) return makeChain(() => noFriend);
          return makeChain(() => existingBan);
        }),
        insert: jest.fn(),
      };
      const svc = new FriendsService(db, events as any);
      await expect(svc.request({ requesterId: 7, targetUsername: 'alice' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe('accept', () => {
    it('flips status to accepted and stamps accepted_at when the user is the counterparty', async () => {
      const row = { id: 42, userA: 3, userB: 7, status: 'pending', requestedBy: 3 };
      let selectCalls = 0;
      const db: any = {
        select: jest.fn(() => {
          selectCalls += 1;
          return makeChain(() => [row]);
        }),
        update: jest.fn(() => makeChain(() => undefined)),
      };
      const svc = new FriendsService(db, events as any);
      await svc.accept({ userId: 7, requestId: 42 });
      expect(db.update).toHaveBeenCalled();
      expect(events.emit).toHaveBeenCalledWith(
        'friend.request.accepted',
        expect.objectContaining({ requestId: 42, accepterId: 7, requesterId: 3 }),
      );
    });

    it('rejects when user tries to accept their own request (requested_by == userId)', async () => {
      const row = { id: 42, userA: 3, userB: 7, status: 'pending', requestedBy: 7 };
      const db: any = {
        select: jest.fn(() => makeChain(() => [row])),
        update: jest.fn(),
      };
      const svc = new FriendsService(db, events as any);
      await expect(svc.accept({ userId: 7, requestId: 42 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(db.update).not.toHaveBeenCalled();
    });

    it('rejects when row is not pending anymore', async () => {
      const row = { id: 42, userA: 3, userB: 7, status: 'accepted', requestedBy: 3 };
      const db: any = {
        select: jest.fn(() => makeChain(() => [row])),
        update: jest.fn(),
      };
      const svc = new FriendsService(db, events as any);
      await expect(svc.accept({ userId: 7, requestId: 42 })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('404s when request id does not exist or user is not a participant', async () => {
      const db: any = {
        select: jest.fn(() => makeChain(() => [])),
        update: jest.fn(),
      };
      const svc = new FriendsService(db, events as any);
      await expect(svc.accept({ userId: 7, requestId: 42 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('reject', () => {
    it('deletes the pending row when the user is the counterparty', async () => {
      const row = { id: 42, userA: 3, userB: 7, status: 'pending', requestedBy: 3 };
      const db: any = {
        select: jest.fn(() => makeChain(() => [row])),
        delete: jest.fn(() => makeChain(() => undefined)),
      };
      const svc = new FriendsService(db, events as any);
      await svc.reject({ userId: 7, requestId: 42 });
      expect(db.delete).toHaveBeenCalled();
    });

    it('rejects when the user is the requester (cannot reject own request, use delete flow)', async () => {
      const row = { id: 42, userA: 3, userB: 7, status: 'pending', requestedBy: 7 };
      const db: any = {
        select: jest.fn(() => makeChain(() => [row])),
        delete: jest.fn(),
      };
      const svc = new FriendsService(db, events as any);
      await expect(svc.reject({ userId: 7, requestId: 42 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(db.delete).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('either side can remove an accepted friendship', async () => {
      const row = { id: 42, userA: 3, userB: 7, status: 'accepted', requestedBy: 3 };
      const db: any = {
        select: jest.fn(() => makeChain(() => [row])),
        delete: jest.fn(() => makeChain(() => undefined)),
      };
      const svc = new FriendsService(db, events as any);
      await svc.remove({ userId: 7, otherUserId: 3 });
      expect(db.delete).toHaveBeenCalled();
      expect(events.emit).toHaveBeenCalledWith(
        'friend.removed',
        expect.objectContaining({ userId: 7, otherUserId: 3 }),
      );
    });

    it('404s when no friendship row exists for the pair', async () => {
      const db: any = {
        select: jest.fn(() => makeChain(() => [])),
        delete: jest.fn(),
      };
      const svc = new FriendsService(db, events as any);
      await expect(svc.remove({ userId: 7, otherUserId: 3 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('returns accepted friends for either side', async () => {
      const rows = [{ friendId: 3, name: 'alice' }];
      const db: any = { select: jest.fn(() => makeChain(() => rows)) };
      const svc = new FriendsService(db, events as any);
      const out = await svc.list({ userId: 7 });
      expect(Array.isArray(out)).toBe(true);
    });

    it('maps rows to {id, friendId, acceptedAt} with correct friendId for both sides (line 240-243 branch)', async () => {
      const now = new Date('2026-04-20');
      const rows = [
        { friendshipId: 10, userA: 3, userB: 7, status: 'accepted', acceptedAt: now }, // viewer=7 -> friendId=3
        { friendshipId: 11, userA: 7, userB: 9, status: 'accepted', acceptedAt: now }, // viewer=7 -> friendId=9
      ];
      const db: any = { select: jest.fn(() => makeChain(() => rows)) };
      const svc = new FriendsService(db, events as any);
      const out = await svc.list({ userId: 7 });
      expect(out).toEqual([
        { id: 10, friendId: 3, acceptedAt: now },
        { id: 11, friendId: 9, acceptedAt: now },
      ]);
    });
  });

  describe('accept edge cases', () => {
    it('404s when row exists but user is neither userA nor userB (line 143)', async () => {
      // Impossible from SQL side but the guard exists; we cover it anyway.
      const row = { id: 42, userA: 3, userB: 7, status: 'pending', requestedBy: 3 };
      const db: any = {
        select: jest.fn(() => makeChain(() => [row])),
        update: jest.fn(),
      };
      const svc = new FriendsService(db, events as any);
      await expect(svc.accept({ userId: 999, requestId: 42 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('reject edge cases', () => {
    it('404s when reject target is not a participant (line 179)', async () => {
      const row = { id: 42, userA: 3, userB: 7, status: 'pending', requestedBy: 3 };
      const db: any = {
        select: jest.fn(() => makeChain(() => [row])),
        delete: jest.fn(),
      };
      const svc = new FriendsService(db, events as any);
      await expect(svc.reject({ userId: 999, requestId: 42 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('409s when reject finds a non-pending row (line 185)', async () => {
      const row = { id: 42, userA: 3, userB: 7, status: 'accepted', requestedBy: 3 };
      const db: any = {
        select: jest.fn(() => makeChain(() => [row])),
        delete: jest.fn(),
      };
      const svc = new FriendsService(db, events as any);
      await expect(svc.reject({ userId: 7, requestId: 42 })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('404s when request id is missing', async () => {
      const db: any = {
        select: jest.fn(() => makeChain(() => [])),
        delete: jest.fn(),
      };
      const svc = new FriendsService(db, events as any);
      await expect(svc.reject({ userId: 7, requestId: 999 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove edge cases', () => {
    it('rejects self-remove with BadRequest', async () => {
      const db: any = { select: jest.fn(), delete: jest.fn() };
      const svc = new FriendsService(db, events as any);
      await expect(svc.remove({ userId: 7, otherUserId: 7 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('listPending (lines 246-264)', () => {
    it('returns pending rows tagged with incoming flag and otherUserId', async () => {
      const rows = [
        {
          id: 10,
          userA: 3,
          userB: 7,
          requestedBy: 3,
          requestText: 'hi',
          createdAt: new Date('2026-04-20T10:00:00Z'),
        },
        {
          id: 11,
          userA: 7,
          userB: 9,
          requestedBy: 7,
          requestText: null,
          createdAt: new Date('2026-04-20T11:00:00Z'),
        },
      ];
      const db: any = { select: jest.fn(() => makeChain(() => rows)) };
      const svc = new FriendsService(db, events as any);

      const out = await svc.listPending({ userId: 7 });
      expect(out).toHaveLength(2);
      // row 10: userA=3 requested, userB=7 is viewer -> incoming
      expect(out[0]).toMatchObject({ id: 10, requesterId: 3, incoming: true, requestText: 'hi' });
      // row 11: viewer 7 requested -> outgoing
      expect(out[1]).toMatchObject({ id: 11, requesterId: 7, incoming: false, requestText: null });
    });

    it('returns an empty list when no pending rows exist', async () => {
      const db: any = { select: jest.fn(() => makeChain(() => [])) };
      const svc = new FriendsService(db, events as any);
      const out = await svc.listPending({ userId: 7 });
      expect(out).toEqual([]);
    });
  });
});
