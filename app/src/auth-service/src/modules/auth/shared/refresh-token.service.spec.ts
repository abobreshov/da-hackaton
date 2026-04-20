// Required env before importing anything touching config/environment.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48);
process.env.JWT_CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);
process.env.SESSION_MAX_DURATION_DAYS = process.env.SESSION_MAX_DURATION_DAYS ?? '7';

import RedisMock from 'ioredis-mock';
import type { CacheService } from '../../../cache/cache.service';
import { RefreshTokenService } from './refresh-token.service';

// Thin CacheService test double backed by ioredis-mock. Mirrors the subset
// of CacheService used by RefreshTokenService so we never hit a real Redis.
function makeCache(): CacheService {
  const client = new RedisMock();
  return {
    client,
    get: (k: string) => client.get(k),
    set: (k: string, v: string, ttl: number) => client.setex(k, ttl, v).then(() => undefined),
    del: (...keys: string[]) => (keys.length ? client.del(...keys).then(() => undefined) : Promise.resolve()),
    sadd: (k: string, ...m: string[]) => client.sadd(k, ...m).then(() => undefined),
    srem: (k: string, ...m: string[]) => client.srem(k, ...m).then(() => undefined),
    smembers: (k: string) => client.smembers(k),
    onModuleDestroy: () => client.disconnect(),
  } as unknown as CacheService;
}

describe('RefreshTokenService', () => {
  let cache: CacheService;
  let svc: RefreshTokenService;

  beforeEach(async () => {
    cache = makeCache();
    // ioredis-mock shares keyspace across instances by default — flush.
    await (cache as unknown as { client: { flushall: () => Promise<void> } }).client.flushall();
    svc = new RefreshTokenService(cache);
  });

  describe('create', () => {
    it('returns a token of the form <type>:<id>:<hex> and stores it in Redis under the tracking set', async () => {
      const token = await svc.create('u', 1);
      expect(token).toMatch(/^u:1:[0-9a-f]{64}$/);

      const members = await cache.smembers('refresh:u:1:tokens');
      expect(members).toHaveLength(1);
      expect(members[0]).toMatch(/^refresh:u:1:[0-9a-f]{64}$/);
    });

    it('applies the 24h TTL to the token key', async () => {
      const token = await svc.create('u', 2);
      // Reach through to the underlying ioredis-mock client exposed on the double.
      const client = (cache as unknown as { client: { ttl: (k: string) => Promise<number> } }).client;
      const { createHash } = await import('crypto');
      const key = `refresh:u:2:${createHash('sha256').update(token).digest('hex')}`;
      const ttl = await client.ttl(key);
      // Allow a small skew — should be close to 24h (86400s), at worst 1s less.
      expect(ttl).toBeGreaterThan(86390);
      expect(ttl).toBeLessThanOrEqual(86400);
    });

    it('supports both admin (a) and customer (u) scopes without collision', async () => {
      const uTok = await svc.create('u', 1);
      const aTok = await svc.create('a', 1);
      expect(uTok).toMatch(/^u:1:/);
      expect(aTok).toMatch(/^a:1:/);
      await expect(cache.smembers('refresh:u:1:tokens')).resolves.toHaveLength(1);
      await expect(cache.smembers('refresh:a:1:tokens')).resolves.toHaveLength(1);
    });
  });

  describe('validateAndRotate', () => {
    it('returns a fresh token and invalidates the old one', async () => {
      const original = await svc.create('u', 5);
      const rotated = await svc.validateAndRotate('u', 5, original);

      expect(rotated).not.toEqual(original);
      expect(rotated).toMatch(/^u:5:[0-9a-f]{64}$/);

      // Old token can no longer be rotated again.
      await expect(svc.validateAndRotate('u', 5, original)).rejects.toThrow(/Invalid or expired/);

      // But the new one still works once.
      await expect(svc.validateAndRotate('u', 5, rotated)).resolves.toMatch(/^u:5:/);
    });

    it('throws on an unknown/expired token', async () => {
      await expect(svc.validateAndRotate('u', 9, 'u:9:deadbeef')).rejects.toThrow(
        /Invalid or expired refresh token/,
      );
    });

    it('rejects once the session exceeds SESSION_MAX_DURATION_DAYS', async () => {
      // Directly seed a refresh-token record whose sessionStartedAt is older than the
      // session cap (SESSION_MAX_DURATION_DAYS = 7 per .env defaults). We bypass
      // svc.create() to keep the Redis TTL fresh while backdating the session marker.
      const { randomBytes, createHash } = await import('crypto');
      const token = `u:3:${randomBytes(32).toString('hex')}`;
      const hash = createHash('sha256').update(token).digest('hex');
      const key = `refresh:u:3:${hash}`;
      const backdated = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago
      await cache.set(key, JSON.stringify({ id: 3, sessionStartedAt: backdated }), 24 * 60 * 60);
      await cache.sadd('refresh:u:3:tokens', key);

      await expect(svc.validateAndRotate('u', 3, token)).rejects.toThrow(/Session expired/);
      // And the stale key is cleaned up.
      await expect(cache.get(key)).resolves.toBeNull();
    });
  });

  describe('revoke', () => {
    it('removes a single token and leaves other tokens intact', async () => {
      const t1 = await svc.create('u', 4);
      const t2 = await svc.create('u', 4);

      await svc.revoke('u', 4, t1);

      await expect(svc.validateAndRotate('u', 4, t1)).rejects.toThrow(/Invalid or expired/);
      await expect(svc.validateAndRotate('u', 4, t2)).resolves.toMatch(/^u:4:/);
    });
  });

  describe('revokeAll', () => {
    it('deletes every refresh key for a user, including the tracking set', async () => {
      await svc.create('u', 8);
      await svc.create('u', 8);
      await svc.create('u', 8);

      await expect(cache.smembers('refresh:u:8:tokens')).resolves.toHaveLength(3);
      await svc.revokeAll('u', 8);
      await expect(cache.smembers('refresh:u:8:tokens')).resolves.toHaveLength(0);
    });

    it('does not touch refresh tokens for other users', async () => {
      await svc.create('u', 10);
      const victim = await svc.create('u', 11);

      await svc.revokeAll('u', 10);

      // User 11's token must still rotate.
      await expect(svc.validateAndRotate('u', 11, victim)).resolves.toMatch(/^u:11:/);
    });
  });
});
