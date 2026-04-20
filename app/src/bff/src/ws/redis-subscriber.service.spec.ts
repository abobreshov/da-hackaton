/**
 * RedisSubscriberService — pub/sub fanout to connected WS sockets.
 *
 * Responsibilities:
 *   - Reference-counted channel subscriptions so two interested sockets
 *     share a single ioredis SUBSCRIBE.
 *   - Interest graph: socket → { rooms, presenceOf }.
 *   - Route incoming `presence.update` on presence:global only to sockets
 *     whose interest set contains that userId (AC-03-11 filter).
 */
jest.mock('../config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    SYSTEM_KEY: 'test-sys-key',
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
  },
}));

import { RedisSubscriberService } from './redis-subscriber.service';

function makeRedis() {
  const handlers = new Map<string, (channel: string, msg: string) => void>();
  return {
    subscribe: jest.fn().mockResolvedValue(1),
    unsubscribe: jest.fn().mockResolvedValue(0),
    on: jest.fn((event: string, cb: any) => {
      handlers.set(event, cb);
    }),
    quit: jest.fn().mockResolvedValue('OK'),
    __trigger(channel: string, msg: string) {
      const cb = handlers.get('message');
      if (cb) cb(channel, msg);
    },
  };
}

describe('RedisSubscriberService', () => {
  let redis: ReturnType<typeof makeRedis>;
  let svc: RedisSubscriberService;

  beforeEach(async () => {
    redis = makeRedis();
    svc = new RedisSubscriberService(redis as any);
    await svc.onModuleInit();
  });

  afterEach(async () => {
    await svc.onModuleDestroy();
  });

  describe('registerSocket / unregisterSocket', () => {
    it('tracks interest graph keyed by socket id', () => {
      const socket = { id: 's1', emit: jest.fn(), rooms: new Set<string>() } as any;
      svc.registerSocket(socket);
      expect(svc.hasSocket('s1')).toBe(true);
      svc.unregisterSocket('s1');
      expect(svc.hasSocket('s1')).toBe(false);
    });
  });

  describe('subscribeFor — reference counting', () => {
    it('2x subscribeFor on same channel → ioredis SUBSCRIBE once', async () => {
      const s1 = { id: 's1', emit: jest.fn(), rooms: new Set<string>() } as any;
      const s2 = { id: 's2', emit: jest.fn(), rooms: new Set<string>() } as any;
      svc.registerSocket(s1);
      svc.registerSocket(s2);

      await svc.subscribeFor('s1', 'room:5');
      await svc.subscribeFor('s2', 'room:5');

      expect(redis.subscribe).toHaveBeenCalledTimes(1);
      expect(redis.subscribe).toHaveBeenCalledWith('room:5');
    });

    it('first unsubscribe after 2 subscribes → no ioredis UNSUBSCRIBE yet', async () => {
      const s1 = { id: 's1', emit: jest.fn(), rooms: new Set<string>() } as any;
      const s2 = { id: 's2', emit: jest.fn(), rooms: new Set<string>() } as any;
      svc.registerSocket(s1);
      svc.registerSocket(s2);
      await svc.subscribeFor('s1', 'room:5');
      await svc.subscribeFor('s2', 'room:5');

      await svc.unsubscribeFor('s1', 'room:5');

      expect(redis.unsubscribe).not.toHaveBeenCalled();
    });

    it('2nd unsubscribe → ioredis UNSUBSCRIBE fires once', async () => {
      const s1 = { id: 's1', emit: jest.fn(), rooms: new Set<string>() } as any;
      const s2 = { id: 's2', emit: jest.fn(), rooms: new Set<string>() } as any;
      svc.registerSocket(s1);
      svc.registerSocket(s2);
      await svc.subscribeFor('s1', 'room:5');
      await svc.subscribeFor('s2', 'room:5');

      await svc.unsubscribeFor('s1', 'room:5');
      await svc.unsubscribeFor('s2', 'room:5');

      expect(redis.unsubscribe).toHaveBeenCalledTimes(1);
      expect(redis.unsubscribe).toHaveBeenCalledWith('room:5');
    });

    it('unregisterSocket releases every channel the socket held', async () => {
      const s1 = { id: 's1', emit: jest.fn(), rooms: new Set<string>() } as any;
      svc.registerSocket(s1);
      await svc.subscribeFor('s1', 'room:5');
      await svc.subscribeFor('s1', 'room:6');

      svc.unregisterSocket('s1');

      // Fire-and-forget — allow microtask flush.
      await Promise.resolve();
      await Promise.resolve();
      expect(redis.unsubscribe).toHaveBeenCalledWith('room:5');
      expect(redis.unsubscribe).toHaveBeenCalledWith('room:6');
    });
  });

  describe('presence interest', () => {
    it('watchPresenceOf adds userId to interest set and subscribes presence:global', async () => {
      const s1 = { id: 's1', emit: jest.fn(), rooms: new Set<string>() } as any;
      svc.registerSocket(s1);

      await svc.watchPresenceOf('s1', [42, 43]);

      expect(redis.subscribe).toHaveBeenCalledWith('presence:global');
      const interest = svc.getInterest('s1');
      expect(interest?.presenceOf.has(42)).toBe(true);
      expect(interest?.presenceOf.has(43)).toBe(true);
    });

    it('presence:global message routes only to sockets interested in that userId', async () => {
      const s1 = { id: 's1', emit: jest.fn(), rooms: new Set<string>() } as any;
      const s2 = { id: 's2', emit: jest.fn(), rooms: new Set<string>() } as any;
      svc.registerSocket(s1);
      svc.registerSocket(s2);

      await svc.watchPresenceOf('s1', [42]);
      await svc.watchPresenceOf('s2', [99]);

      redis.__trigger('presence:global', JSON.stringify({ userId: 42, state: 'online' }));

      expect(s1.emit).toHaveBeenCalledWith('presence.update', { userId: 42, state: 'online' });
      expect(s2.emit).not.toHaveBeenCalled();
    });

    it('ignores malformed JSON on presence:global', async () => {
      const s1 = { id: 's1', emit: jest.fn(), rooms: new Set<string>() } as any;
      svc.registerSocket(s1);
      await svc.watchPresenceOf('s1', [42]);

      expect(() => redis.__trigger('presence:global', 'not-json')).not.toThrow();
      expect(s1.emit).not.toHaveBeenCalled();
    });
  });

  describe('room channel fanout', () => {
    it('room:<id> message emits to every socket in that interest set', async () => {
      const s1 = { id: 's1', emit: jest.fn(), rooms: new Set<string>() } as any;
      const s2 = { id: 's2', emit: jest.fn(), rooms: new Set<string>() } as any;
      const s3 = { id: 's3', emit: jest.fn(), rooms: new Set<string>() } as any;
      svc.registerSocket(s1);
      svc.registerSocket(s2);
      svc.registerSocket(s3);

      await svc.subscribeFor('s1', 'room:5');
      await svc.subscribeFor('s2', 'room:5');
      // s3 not subscribed → should not receive

      redis.__trigger(
        'room:5',
        JSON.stringify({ event: 'message.new', payload: { id: 101, body: 'hi' } }),
      );

      expect(s1.emit).toHaveBeenCalledWith('message.new', { id: 101, body: 'hi' });
      expect(s2.emit).toHaveBeenCalledWith('message.new', { id: 101, body: 'hi' });
      expect(s3.emit).not.toHaveBeenCalled();
    });
  });
});
