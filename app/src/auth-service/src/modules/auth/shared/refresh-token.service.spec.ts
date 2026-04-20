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
    setNx: async (k: string, v: string, ttl: number) => {
      const res = await client.set(k, v, 'EX', ttl, 'NX');
      return res === 'OK';
    },
    exists: async (k: string) => (await client.exists(k)) > 0,
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
      const client = (cache as unknown as { client: { ttl: (k: string) => Promise<number> } }).client;
      const { createHash } = await import('crypto');
      const key = `refresh:u:2:${createHash('sha256').update(token).digest('hex')}`;
      const ttl = await client.ttl(key);
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

    it('seeds a fresh familyId per login and records its member set', async () => {
      await svc.create('u', 20);
      const client = (cache as unknown as { client: { keys: (p: string) => Promise<string[]> } }).client;
      const famKeys = await client.keys('refresh:u:20:fam:*:members');
      expect(famKeys).toHaveLength(1);

      // Two separate logins → two distinct families.
      await svc.create('u', 20);
      const famKeys2 = await client.keys('refresh:u:20:fam:*:members');
      expect(famKeys2).toHaveLength(2);
    });
  });

  describe('validateAndRotate', () => {
    it('returns a fresh token and invalidates the old one', async () => {
      const original = await svc.create('u', 5);
      const rotated = await svc.validateAndRotate('u', 5, original);

      expect(rotated).not.toEqual(original);
      expect(rotated).toMatch(/^u:5:[0-9a-f]{64}$/);

      // The new one still works once.
      await expect(svc.validateAndRotate('u', 5, rotated)).resolves.toMatch(/^u:5:/);
    });

    it('throws on an unknown/expired token', async () => {
      await expect(svc.validateAndRotate('u', 9, 'u:9:deadbeef')).rejects.toThrow(
        /Invalid or expired refresh token/,
      );
    });

    it('rejects once the session exceeds SESSION_MAX_DURATION_DAYS', async () => {
      // Directly seed a refresh-token record whose sessionStartedAt is older than the
      // session cap (SESSION_MAX_DURATION_DAYS = 7 per .env defaults).
      const { randomBytes, createHash, randomUUID } = await import('crypto');
      const token = `u:3:${randomBytes(32).toString('hex')}`;
      const hash = createHash('sha256').update(token).digest('hex');
      const key = `refresh:u:3:${hash}`;
      const familyId = randomUUID();
      const backdated = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago
      await cache.set(key, JSON.stringify({ id: 3, familyId, sessionStartedAt: backdated }), 24 * 60 * 60);
      await cache.sadd('refresh:u:3:tokens', key);

      await expect(svc.validateAndRotate('u', 3, token)).rejects.toThrow(/Session expired/);
      // And the stale key is cleaned up.
      await expect(cache.get(key)).resolves.toBeNull();
    });

    // ---- OAuth 2.1 §6.1 reuse detection ------------------------------------

    it('REUSE: replaying an already-rotated token kills the entire family', async () => {
      const original = await svc.create('u', 100);
      const rotated = await svc.validateAndRotate('u', 100, original);
      // Presenting the old token again ⇒ reuse.
      await expect(svc.validateAndRotate('u', 100, original)).rejects.toThrow(
        /reuse detected/i,
      );
      // The rotated (previously-valid) sibling must now also be dead.
      await expect(svc.validateAndRotate('u', 100, rotated)).rejects.toThrow(
        /Invalid or expired/,
      );
    });

    it('REUSE: family revocation also kills any later-issued tokens from the same login', async () => {
      // A -> rotate -> B -> rotate -> C. All three share familyId.
      const a = await svc.create('u', 101);
      const b = await svc.validateAndRotate('u', 101, a);
      const c = await svc.validateAndRotate('u', 101, b);
      // Attacker replays the oldest token. `c` (the currently valid one)
      // must die along with everything else in the family.
      await expect(svc.validateAndRotate('u', 101, a)).rejects.toThrow(/reuse detected/i);
      await expect(svc.validateAndRotate('u', 101, c)).rejects.toThrow(/Invalid or expired/);
    });

    it('REUSE: independent families for the same user are not affected', async () => {
      // Family 1: login + one rotate, then attacker replays the old token.
      const fam1Initial = await svc.create('u', 102);
      await svc.validateAndRotate('u', 102, fam1Initial);

      // Family 2: completely separate login happens in parallel (e.g. another device).
      const fam2 = await svc.create('u', 102);

      // Reuse on family 1 → must not touch family 2.
      await expect(svc.validateAndRotate('u', 102, fam1Initial)).rejects.toThrow(
        /reuse detected/i,
      );
      // Family 2 can still rotate.
      await expect(svc.validateAndRotate('u', 102, fam2)).resolves.toMatch(/^u:102:/);
    });

    it('REUSE: user A replay does not kill user B', async () => {
      const userAOriginal = await svc.create('u', 200);
      await svc.validateAndRotate('u', 200, userAOriginal);
      const userBToken = await svc.create('u', 201);

      await expect(svc.validateAndRotate('u', 200, userAOriginal)).rejects.toThrow(
        /reuse detected/i,
      );
      // User B is fully insulated.
      await expect(svc.validateAndRotate('u', 201, userBToken)).resolves.toMatch(/^u:201:/);
    });

    it('REUSE: admin scope is revoked independently of customer scope', async () => {
      // Same numeric id across scopes — must remain isolated.
      const adminOriginal = await svc.create('a', 7);
      await svc.validateAndRotate('a', 7, adminOriginal);
      const customerToken = await svc.create('u', 7);

      await expect(svc.validateAndRotate('a', 7, adminOriginal)).rejects.toThrow(
        /reuse detected/i,
      );
      await expect(svc.validateAndRotate('u', 7, customerToken)).resolves.toMatch(/^u:7:/);
    });
  });

  describe('revoke', () => {
    it('removes a single token and leaves other tokens intact', async () => {
      const t1 = await svc.create('u', 4);
      const t2 = await svc.create('u', 4);

      await svc.revoke('u', 4, t1);

      // Revocation of a *spent* token is not reuse — it just no longer rotates.
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
