/**
 * Unit tests for UnreadService (EPIC-09). Fake repo exercises the scope XOR,
 * upsert semantics, and cap-at-99 rule without hitting Postgres.
 */

import { BadRequestException } from '@nestjs/common';
import { UnreadService } from './unread.service';
import {
  CountSinceInput,
  DmUnread,
  MarkReadInput,
  RoomUnread,
  UNREAD_CAP,
  UnreadRepositoryPort,
} from './unread.types';

class FakeUnreadRepository implements UnreadRepositoryPort {
  marks: MarkReadInput[] = [];
  roomUnreads = new Map<number, RoomUnread[]>();
  dmUnreads = new Map<number, DmUnread[]>();
  countResponses = new Map<string, number>();

  async upsertLastRead(input: MarkReadInput): Promise<void> {
    // Mirror the functional-index upsert semantics — same
    // `(userId, roomId|0, dmId|0)` key overwrites.
    const key = scopeKey(input);
    const idx = this.marks.findIndex((m) => scopeKey(m) === key);
    if (idx >= 0) this.marks[idx] = { ...input };
    else this.marks.push({ ...input });
  }

  async unreadRoomsFor(userId: number): Promise<RoomUnread[]> {
    return (this.roomUnreads.get(userId) ?? []).map((r) => ({
      ...r,
      count: Math.min(r.count, UNREAD_CAP),
    }));
  }

  async unreadDmsFor(userId: number): Promise<DmUnread[]> {
    return (this.dmUnreads.get(userId) ?? []).map((d) => ({
      ...d,
      count: Math.min(d.count, UNREAD_CAP),
    }));
  }

  async countSince(input: CountSinceInput): Promise<number> {
    const key = countKey(input);
    const raw = this.countResponses.get(key) ?? 0;
    return Math.min(raw, UNREAD_CAP);
  }

  async countSinceForRoomMembers(
    roomId: number,
    userIds: number[],
  ): Promise<Array<{ userId: number; count: number }>> {
    return userIds.map((userId) => {
      const raw = this.countResponses.get(`${userId}:${roomId}:0`) ?? 0;
      return { userId, count: Math.min(raw, UNREAD_CAP) };
    });
  }
}

function scopeKey(m: { userId: number; roomId?: number; dmId?: number }): string {
  return `${m.userId}:${m.roomId ?? 0}:${m.dmId ?? 0}`;
}

function countKey(m: CountSinceInput): string {
  return `${m.userId}:${m.roomId ?? 0}:${m.dmId ?? 0}`;
}

const USER = 42;

describe('UnreadService', () => {
  let repo: FakeUnreadRepository;
  let svc: UnreadService;

  beforeEach(() => {
    repo = new FakeUnreadRepository();
    svc = new UnreadService(repo);
  });

  describe('markRead — XOR scope', () => {
    it('rejects when neither roomId nor dmId is present', async () => {
      await expect(svc.markRead({ userId: USER, lastReadId: 10n })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects when both roomId and dmId are present', async () => {
      await expect(
        svc.markRead({ userId: USER, roomId: 1, dmId: 2, lastReadId: 10n }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('upserts room scope', async () => {
      await svc.markRead({ userId: USER, roomId: 7, lastReadId: 100n });
      expect(repo.marks).toEqual([{ userId: USER, roomId: 7, lastReadId: 100n }]);
    });

    it('upserts dm scope', async () => {
      await svc.markRead({ userId: USER, dmId: 3, lastReadId: 55n });
      expect(repo.marks).toEqual([{ userId: USER, dmId: 3, lastReadId: 55n }]);
    });

    it('repeated markRead on the same scope overwrites the previous row', async () => {
      await svc.markRead({ userId: USER, roomId: 7, lastReadId: 100n });
      await svc.markRead({ userId: USER, roomId: 7, lastReadId: 200n });
      expect(repo.marks).toHaveLength(1);
      expect(repo.marks[0]).toMatchObject({ roomId: 7, lastReadId: 200n });
    });

    it('room and dm scopes are independent rows', async () => {
      await svc.markRead({ userId: USER, roomId: 7, lastReadId: 100n });
      await svc.markRead({ userId: USER, dmId: 7, lastReadId: 42n });
      expect(repo.marks).toHaveLength(2);
    });
  });

  describe('getUnreadCounts', () => {
    it('returns `{rooms, dms}` from the repo', async () => {
      repo.roomUnreads.set(USER, [
        { roomId: 1, count: 5 },
        { roomId: 2, count: 0 },
      ]);
      repo.dmUnreads.set(USER, [{ dmId: 11, peerUserId: 77, count: 3 }]);

      const out = await svc.getUnreadCounts({ userId: USER });
      expect(out.rooms).toEqual([
        { roomId: 1, count: 5 },
        { roomId: 2, count: 0 },
      ]);
      expect(out.dms).toEqual([{ dmId: 11, peerUserId: 77, count: 3 }]);
    });

    it('returns empty arrays when there is nothing unread', async () => {
      const out = await svc.getUnreadCounts({ userId: USER });
      expect(out).toEqual({ rooms: [], dms: [] });
    });

    it('respects the 99 cap enforced by the repo (AC-09-03)', async () => {
      repo.roomUnreads.set(USER, [{ roomId: 1, count: 1000 }]);
      const out = await svc.getUnreadCounts({ userId: USER });
      expect(out.rooms[0].count).toBe(UNREAD_CAP);
    });
  });

  describe('countSince', () => {
    it('rejects when neither roomId nor dmId is present', async () => {
      await expect(svc.countSince({ userId: USER })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when both roomId and dmId are present', async () => {
      await expect(svc.countSince({ userId: USER, roomId: 1, dmId: 2 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('returns the single-scope count for room', async () => {
      repo.countResponses.set(`${USER}:9:0`, 4);
      const out = await svc.countSince({ userId: USER, roomId: 9 });
      expect(out).toBe(4);
    });

    it('returns the single-scope count for dm', async () => {
      repo.countResponses.set(`${USER}:0:11`, 2);
      const out = await svc.countSince({ userId: USER, dmId: 11 });
      expect(out).toBe(2);
    });

    it('caps the returned count at 99', async () => {
      repo.countResponses.set(`${USER}:9:0`, 500);
      const out = await svc.countSince({ userId: USER, roomId: 9 });
      expect(out).toBe(UNREAD_CAP);
    });
  });

  describe('countsSinceForRoomMembers', () => {
    it('returns one tuple per requested userId in input order', async () => {
      repo.countResponses.set(`20:7:0`, 3);
      repo.countResponses.set(`30:7:0`, 1);
      const out = await svc.countsSinceForRoomMembers(7, [20, 30]);
      expect(out).toEqual([
        { userId: 20, count: 3 },
        { userId: 30, count: 1 },
      ]);
    });

    it('returns an empty array when given no userIds (no SQL round-trip)', async () => {
      const spy = jest.spyOn(repo, 'countSinceForRoomMembers');
      const out = await svc.countsSinceForRoomMembers(7, []);
      expect(out).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    });

    it('caps each per-user count at 99', async () => {
      repo.countResponses.set(`20:7:0`, 5000);
      const out = await svc.countsSinceForRoomMembers(7, [20]);
      expect(out).toEqual([{ userId: 20, count: UNREAD_CAP }]);
    });
  });
});
