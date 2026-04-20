/**
 * PresenceService (EPIC-02).
 *
 * Contract under test:
 *   - `touch(userId, sessionId)`: HSET HASH `presence:sessions:{userId}` entry
 *     `{ sessionId: NOW }`. Re-derives state; on transition (e.g. new user →
 *     online, afk → online) sets STRING `presence:state:{userId}` with TTL
 *     90s and eagerly publishes via PresencePublisher.
 *   - `disconnect(userId, sessionId)`: HDEL sessionId from HASH. If HASH now
 *     empty → state=offline, DEL state key, eager publish. Otherwise re-derive
 *     state and publish only if changed.
 *   - `stateOf(userIds[])`: batch MGET `presence:state:{id}` for every user;
 *     missing keys default to 'offline'. Returns `Map<userId, state>`.
 *   - `evaluate()`: scheduler tick. For every user with a sessions HASH, if
 *     freshest ts > AFK_THRESHOLD_SECONDS ago → afk; if HASH empty or all
 *     entries stale beyond (AFK + grace) → offline and DEL state key. Eager
 *     publish on every observed state change.
 *
 * State derivation rule (internal): any session ts within AFK threshold
 * window → online; else if at least one session exists (stale) → afk; else
 * offline.
 */

jest.mock('../../config/environment', () => ({
  env: {
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    AFK_THRESHOLD_SECONDS: 60,
  },
}));

import { PresenceService } from './presence.service';
import type { PresencePublisher } from '../transport/presence-publisher.service';

type RedisMock = {
  hset: jest.Mock;
  hgetall: jest.Mock;
  hdel: jest.Mock;
  del: jest.Mock;
  expire: jest.Mock;
  set: jest.Mock;
  get: jest.Mock;
  mget: jest.Mock;
  scan: jest.Mock;
  quit: jest.Mock;
  disconnect: jest.Mock;
};

function makeRedis(): RedisMock {
  return {
    hset: jest.fn(async () => 1),
    hgetall: jest.fn(async () => ({})),
    hdel: jest.fn(async () => 1),
    del: jest.fn(async () => 1),
    expire: jest.fn(async () => 1),
    set: jest.fn(async () => 'OK' as const),
    get: jest.fn(async () => null),
    mget: jest.fn(async () => []),
    scan: jest.fn(async () => ['0', []]),
    quit: jest.fn(async () => 'OK' as const),
    disconnect: jest.fn(),
  };
}

function makePublisher(): jest.Mocked<PresencePublisher> {
  return {
    publish: jest.fn(),
  } as unknown as jest.Mocked<PresencePublisher>;
}

describe('PresenceService', () => {
  let redis: RedisMock;
  let publisher: jest.Mocked<PresencePublisher>;
  let service: PresenceService;
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    redis = makeRedis();
    publisher = makePublisher();
    service = new PresenceService(redis as any, publisher);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('touch', () => {
    it('writes HASH entry with current timestamp', async () => {
      redis.get.mockResolvedValueOnce(null); // prev state unknown
      redis.hgetall.mockResolvedValueOnce({ sess1: String(NOW) });

      await service.touch(42, 'sess1');

      expect(redis.hset).toHaveBeenCalledWith(
        'presence:sessions:42',
        'sess1',
        String(NOW),
      );
    });

    it('on new user (no prior state) derives online + publishes', async () => {
      redis.get.mockResolvedValueOnce(null);
      redis.hgetall.mockResolvedValueOnce({ sess1: String(NOW) });

      await service.touch(42, 'sess1');

      expect(redis.set).toHaveBeenCalledWith(
        'presence:state:42',
        'online',
        'EX',
        90,
      );
      expect(publisher.publish).toHaveBeenCalledWith(42, 'online');
    });

    it('afk → online publishes on transition', async () => {
      redis.get.mockResolvedValueOnce('afk');
      redis.hgetall.mockResolvedValueOnce({ sess1: String(NOW) });

      await service.touch(42, 'sess1');

      expect(publisher.publish).toHaveBeenCalledWith(42, 'online');
      expect(redis.set).toHaveBeenCalledWith(
        'presence:state:42',
        'online',
        'EX',
        90,
      );
    });

    it('online → online does NOT publish (no transition)', async () => {
      redis.get.mockResolvedValueOnce('online');
      redis.hgetall.mockResolvedValueOnce({ sess1: String(NOW) });

      await service.touch(42, 'sess1');

      expect(publisher.publish).not.toHaveBeenCalled();
      // TTL refresh is allowed but no state change transition.
    });

    it('refreshes TTL on the state key on every touch (safety-net heartbeat)', async () => {
      redis.get.mockResolvedValueOnce('online');
      redis.hgetall.mockResolvedValueOnce({ sess1: String(NOW) });

      await service.touch(42, 'sess1');

      // Either a plain EXPIRE or a re-SET with EX counts; we allow either.
      const refreshedByExpire = (redis.expire as jest.Mock).mock.calls.some(
        ([k, ttl]) => k === 'presence:state:42' && ttl === 90,
      );
      const refreshedBySet = (redis.set as jest.Mock).mock.calls.some(
        ([k, _v, flag, ttl]) =>
          k === 'presence:state:42' && flag === 'EX' && ttl === 90,
      );
      expect(refreshedByExpire || refreshedBySet).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('removes sessionId from HASH', async () => {
      redis.hgetall.mockResolvedValueOnce({});
      redis.get.mockResolvedValueOnce('online');

      await service.disconnect(42, 'sess1');

      expect(redis.hdel).toHaveBeenCalledWith('presence:sessions:42', 'sess1');
    });

    it('last session gone → offline, DEL state key, eager publish', async () => {
      redis.hgetall.mockResolvedValueOnce({}); // no sessions left
      redis.get.mockResolvedValueOnce('online');

      await service.disconnect(42, 'sess1');

      expect(redis.del).toHaveBeenCalledWith('presence:state:42');
      expect(publisher.publish).toHaveBeenCalledWith(42, 'offline');
    });

    it('other sessions still fresh → stays online, no publish', async () => {
      redis.hgetall.mockResolvedValueOnce({ sess2: String(NOW) });
      redis.get.mockResolvedValueOnce('online');

      await service.disconnect(42, 'sess1');

      expect(publisher.publish).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('other sessions all stale → transitions to afk + publish', async () => {
      const staleTs = String(NOW - 5 * 60_000); // 5 min ago, beyond AFK
      redis.hgetall.mockResolvedValueOnce({ sess2: staleTs });
      redis.get.mockResolvedValueOnce('online');

      await service.disconnect(42, 'sess1');

      expect(publisher.publish).toHaveBeenCalledWith(42, 'afk');
      expect(redis.set).toHaveBeenCalledWith(
        'presence:state:42',
        'afk',
        'EX',
        90,
      );
    });
  });

  describe('stateOf', () => {
    it('returns a Map<userId, state> from MGET results', async () => {
      redis.mget.mockResolvedValueOnce(['online', null, 'afk']);

      const result = await service.stateOf([1, 2, 3]);

      expect(redis.mget).toHaveBeenCalledWith(
        'presence:state:1',
        'presence:state:2',
        'presence:state:3',
      );
      expect(result.get(1)).toBe('online');
      expect(result.get(2)).toBe('offline'); // missing → offline default
      expect(result.get(3)).toBe('afk');
    });

    it('empty list → empty map + no Redis call', async () => {
      const result = await service.stateOf([]);
      expect(result.size).toBe(0);
      expect(redis.mget).not.toHaveBeenCalled();
    });

    it('unknown string values fall back to offline', async () => {
      redis.mget.mockResolvedValueOnce(['garbage']);
      const result = await service.stateOf([99]);
      expect(result.get(99)).toBe('offline');
    });
  });

  describe('evaluate', () => {
    it('stale freshest ts (> AFK threshold) → afk + publish when changed', async () => {
      const staleTs = String(NOW - 120_000); // 2 min ago
      // SCAN returns one matching user key, cursor=0 terminates.
      redis.scan.mockResolvedValueOnce(['0', ['presence:sessions:42']]);
      redis.hgetall.mockResolvedValueOnce({ sessA: staleTs });
      redis.get.mockResolvedValueOnce('online');

      await service.evaluate();

      expect(publisher.publish).toHaveBeenCalledWith(42, 'afk');
      expect(redis.set).toHaveBeenCalledWith(
        'presence:state:42',
        'afk',
        'EX',
        90,
      );
    });

    it('empty sessions HASH → offline + DEL state + publish', async () => {
      redis.scan.mockResolvedValueOnce(['0', ['presence:sessions:42']]);
      redis.hgetall.mockResolvedValueOnce({});
      redis.get.mockResolvedValueOnce('afk');

      await service.evaluate();

      expect(redis.del).toHaveBeenCalledWith('presence:state:42');
      expect(publisher.publish).toHaveBeenCalledWith(42, 'offline');
    });

    it('fresh session ts → online, no publish if already online', async () => {
      redis.scan.mockResolvedValueOnce(['0', ['presence:sessions:42']]);
      redis.hgetall.mockResolvedValueOnce({ sessA: String(NOW) });
      redis.get.mockResolvedValueOnce('online');

      await service.evaluate();

      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('iterates SCAN cursors until 0', async () => {
      // Two iterations: cursor 10 → more, cursor 0 → stop.
      redis.scan
        .mockResolvedValueOnce(['10', ['presence:sessions:1']])
        .mockResolvedValueOnce(['0', ['presence:sessions:2']]);
      redis.hgetall
        .mockResolvedValueOnce({ a: String(NOW) })
        .mockResolvedValueOnce({ b: String(NOW) });
      redis.get.mockResolvedValue('online');

      await service.evaluate();

      expect(redis.scan).toHaveBeenCalledTimes(2);
    });
  });
});
