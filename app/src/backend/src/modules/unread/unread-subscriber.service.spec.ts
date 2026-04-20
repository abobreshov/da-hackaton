/**
 * Unit tests for UnreadSubscriber (EPIC-09 AC-09-04).
 *
 * Translates `message.created` domain events into per-recipient
 * `unread.changed` Redis PUBLISH on `user:{id}`. Uses a FakeEventPublisher
 * that drives subscriber handlers synchronously and a FakeRedis that
 * records publish calls.
 */

import { UnreadSubscriber } from './unread-subscriber.service';
import { RedisChannel } from '@app/contracts';

type EventHandler = (payload: unknown) => void | Promise<void>;

class FakeEventPublisher {
  private readonly handlers = new Map<string, EventHandler[]>();
  emit(event: string, payload: unknown): void {
    const hs = this.handlers.get(event) ?? [];
    for (const h of hs) void h(payload);
  }
  on(event: string, handler: EventHandler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }
  async dispatch(event: string, payload: unknown): Promise<void> {
    const hs = this.handlers.get(event) ?? [];
    await Promise.all(hs.map((h) => h(payload)));
  }
}

class FakeRedis {
  publishes: Array<{ channel: string; payload: string }> = [];
  async publish(channel: string, payload: string): Promise<number> {
    this.publishes.push({ channel, payload });
    return 1;
  }
}

interface MembersFake {
  membersOf: jest.Mock;
}

function makeRooms(members: Array<{ userId: number }>): MembersFake {
  return {
    membersOf: jest.fn(async () => ({
      members: members.map((m) => ({ userId: m.userId, role: 'member', username: `u${m.userId}` })),
    })),
  };
}

describe('UnreadSubscriber', () => {
  let publisher: FakeEventPublisher;
  let redis: FakeRedis;
  let unread: { countSince: jest.Mock };

  beforeEach(() => {
    publisher = new FakeEventPublisher();
    redis = new FakeRedis();
    unread = { countSince: jest.fn(async (i: any) => (i.userId === 20 ? 3 : 7)) };
  });

  function boot(rooms: MembersFake): UnreadSubscriber {
    const sub = new UnreadSubscriber(publisher as any, unread as any, rooms as any, redis as any);
    sub.onApplicationBootstrap();
    return sub;
  }

  describe('room-scope message.created', () => {
    it('publishes unread.changed to each member except the author', async () => {
      const rooms = makeRooms([{ userId: 10 }, { userId: 20 }, { userId: 30 }]);
      boot(rooms);

      await publisher.dispatch('message.created', {
        scope: 'room',
        messageId: 42n,
        authorId: 10,
        roomId: 7,
      });

      expect(rooms.membersOf).toHaveBeenCalledWith(7);
      expect(unread.countSince).toHaveBeenCalledTimes(2);
      expect(unread.countSince).toHaveBeenCalledWith({ userId: 20, roomId: 7 });
      expect(unread.countSince).toHaveBeenCalledWith({ userId: 30, roomId: 7 });

      expect(redis.publishes).toHaveLength(2);
      const byChannel = Object.fromEntries(redis.publishes.map((p) => [p.channel, p.payload]));
      expect(JSON.parse(byChannel[RedisChannel.user(20)])).toEqual({
        event: 'unread.changed',
        scope: { roomId: 7 },
        count: 3,
      });
      expect(JSON.parse(byChannel[RedisChannel.user(30)])).toEqual({
        event: 'unread.changed',
        scope: { roomId: 7 },
        count: 7,
      });
    });

    it('does not publish to the author when they are also a member', async () => {
      const rooms = makeRooms([{ userId: 10 }]);
      boot(rooms);

      await publisher.dispatch('message.created', {
        scope: 'room',
        messageId: 1n,
        authorId: 10,
        roomId: 7,
      });

      expect(redis.publishes).toHaveLength(0);
      expect(unread.countSince).not.toHaveBeenCalled();
    });

    it('swallows errors from membersOf without throwing', async () => {
      const rooms = {
        membersOf: jest.fn(async () => {
          throw new Error('room vanished');
        }),
      };
      boot(rooms as any);

      await expect(
        publisher.dispatch('message.created', {
          scope: 'room',
          messageId: 1n,
          authorId: 10,
          roomId: 7,
        }),
      ).resolves.not.toThrow();
      expect(redis.publishes).toHaveLength(0);
    });
  });

  describe('dm-scope message.created', () => {
    it('publishes unread.changed to the peer only', async () => {
      const rooms = makeRooms([]);
      boot(rooms);

      await publisher.dispatch('message.created', {
        scope: 'dm',
        messageId: 99n,
        authorId: 10,
        dmId: 3,
        peerUserId: 20,
      });

      expect(rooms.membersOf).not.toHaveBeenCalled();
      expect(unread.countSince).toHaveBeenCalledWith({ userId: 20, dmId: 3 });
      expect(redis.publishes).toHaveLength(1);
      expect(redis.publishes[0].channel).toBe(RedisChannel.user(20));
      expect(JSON.parse(redis.publishes[0].payload)).toEqual({
        event: 'unread.changed',
        scope: { dmId: 3, peerUserId: 10 },
        count: 3,
      });
    });

    it('swallows redis.publish errors', async () => {
      const rooms = makeRooms([]);
      const sub = new UnreadSubscriber(
        publisher as any,
        unread as any,
        rooms as any,
        {
          publish: jest.fn(async () => {
            throw new Error('boom');
          }),
        } as any,
      );
      sub.onApplicationBootstrap();

      await expect(
        publisher.dispatch('message.created', {
          scope: 'dm',
          messageId: 99n,
          authorId: 10,
          dmId: 3,
          peerUserId: 20,
        }),
      ).resolves.not.toThrow();
    });
  });

  it('ignores malformed payloads', async () => {
    const rooms = makeRooms([]);
    boot(rooms);

    await publisher.dispatch('message.created', null);
    await publisher.dispatch('message.created', { scope: 'bogus' });
    await publisher.dispatch('message.created', { scope: 'room' });

    expect(redis.publishes).toHaveLength(0);
    expect(unread.countSince).not.toHaveBeenCalled();
  });
});
