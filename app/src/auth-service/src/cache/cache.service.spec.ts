process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48);
process.env.JWT_CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);

// Use ioredis-mock as a drop-in in place of ioredis for this suite.
// Not setting it globally in jest.config to preserve production behavior elsewhere.
jest.mock('ioredis', () => {
   
  return require('ioredis-mock');
});

import { CacheService } from './cache.service';

describe('CacheService', () => {
  let svc: CacheService;

  beforeEach(async () => {
    svc = new CacheService();
    // Every instance shares keyspace by default in ioredis-mock — flush.
    await (svc.client as unknown as { flushall: () => Promise<void> }).flushall();
  });

  afterEach(() => {
    svc.onModuleDestroy();
  });

  describe('set / get', () => {
    it('round-trips a value with EX TTL applied', async () => {
      await svc.set('k', 'v', 60);
      await expect(svc.get('k')).resolves.toBe('v');
      const ttl = await (svc.client as unknown as { ttl: (k: string) => Promise<number> }).ttl('k');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it('get returns null for a missing key', async () => {
      await expect(svc.get('missing')).resolves.toBeNull();
    });
  });

  describe('del', () => {
    it('no-ops safely when given no keys', async () => {
      await expect(svc.del()).resolves.toBeUndefined();
    });

    it('deletes the specified keys', async () => {
      await svc.set('a', '1', 60);
      await svc.set('b', '2', 60);
      await svc.del('a', 'b');
      await expect(svc.get('a')).resolves.toBeNull();
      await expect(svc.get('b')).resolves.toBeNull();
    });
  });

  describe('setNx', () => {
    it('returns true and stores the value when the key is new', async () => {
      await expect(svc.setNx('nx', 'first', 60)).resolves.toBe(true);
      await expect(svc.get('nx')).resolves.toBe('first');
    });

    it('returns false and leaves the existing value untouched on collision', async () => {
      await svc.setNx('nx', 'first', 60);
      await expect(svc.setNx('nx', 'second', 60)).resolves.toBe(false);
      await expect(svc.get('nx')).resolves.toBe('first');
    });

    it('applies the TTL', async () => {
      await svc.setNx('nx', 'v', 45);
      const ttl = await (svc.client as unknown as { ttl: (k: string) => Promise<number> }).ttl(
        'nx',
      );
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(45);
    });
  });

  describe('exists', () => {
    it('returns false for a missing key', async () => {
      await expect(svc.exists('missing')).resolves.toBe(false);
    });

    it('returns true for a present key', async () => {
      await svc.set('k', 'v', 60);
      await expect(svc.exists('k')).resolves.toBe(true);
    });
  });

  describe('set/srem/smembers', () => {
    it('sadd adds members, smembers lists them, srem removes them', async () => {
      await svc.sadd('s', 'x', 'y', 'z');
      const all = await svc.smembers('s');
      expect(all.sort()).toEqual(['x', 'y', 'z']);

      await svc.srem('s', 'y');
      const rest = await svc.smembers('s');
      expect(rest.sort()).toEqual(['x', 'z']);
    });

    it('smembers returns [] for a missing set', async () => {
      await expect(svc.smembers('never')).resolves.toEqual([]);
    });
  });

  describe('onModuleDestroy', () => {
    it('disconnects the underlying client (idempotent-safe to call twice)', () => {
      const spy = jest.spyOn(svc.client, 'disconnect');
      svc.onModuleDestroy();
      expect(spy).toHaveBeenCalled();
    });
  });
});
