process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48);
process.env.JWT_CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);

import { authenticator } from 'otplib';
import RedisMock from 'ioredis-mock';
import type { CacheService } from '../../../cache/cache.service';
import { TotpService } from './totp.service';

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
    del: (...keys: string[]) =>
      keys.length ? client.del(...keys).then(() => undefined) : Promise.resolve(),
    sadd: (k: string, ...m: string[]) => client.sadd(k, ...m).then(() => undefined),
    srem: (k: string, ...m: string[]) => client.srem(k, ...m).then(() => undefined),
    smembers: (k: string) => client.smembers(k),
    onModuleDestroy: () => client.disconnect(),
  } as unknown as CacheService;
}

describe('TotpService', () => {
  // generateSecret / generateQrCode / verify: no cache needed.
  describe('no-cache suite (pure crypto)', () => {
    const svc = new TotpService();

    describe('generateSecret', () => {
      it('returns a base32 string of reasonable length', () => {
        const secret = svc.generateSecret();
        expect(secret).toMatch(/^[A-Z2-7]+=*$/);
        expect(secret.length).toBeGreaterThanOrEqual(16);
      });

      it('produces a fresh secret on each call', () => {
        const a = svc.generateSecret();
        const b = svc.generateSecret();
        expect(a).not.toEqual(b);
      });
    });

    describe('generateQrCode', () => {
      it('returns a data-url PNG embedding the otpauth URI', async () => {
        const secret = svc.generateSecret();
        const url = await svc.generateQrCode('user@example.com', secret, 'TestApp');
        expect(url.startsWith('data:image/png;base64,')).toBe(true);
      });
    });

    describe('verify', () => {
      it('returns true for the code generated right now', () => {
        const secret = svc.generateSecret();
        const code = authenticator.generate(secret);
        expect(svc.verify(code, secret)).toBe(true);
      });

      it('returns false for an obviously wrong 6-digit code', () => {
        const secret = svc.generateSecret();
        expect(svc.verify('000000', secret)).toBe(false);
      });

      it('returns false for a non-numeric token', () => {
        const secret = svc.generateSecret();
        expect(svc.verify('abcdef', secret)).toBe(false);
      });

      it('returns false for a code generated with a different secret', () => {
        const victimSecret = svc.generateSecret();
        const attackerSecret = svc.generateSecret();
        const attackerCode = authenticator.generate(attackerSecret);
        expect(svc.verify(attackerCode, victimSecret)).toBe(false);
      });

      it('uses a strict (window=0) time-step check — previous/next step codes are rejected', () => {
        const secret = svc.generateSecret();
        const realNow = Date.now;
        try {
          Date.now = () => realNow() - 31 * 1000;
          const prevStepCode = authenticator.generate(secret);
          Date.now = realNow;
          expect(svc.verify(prevStepCode, secret)).toBe(false);
        } finally {
          Date.now = realNow;
        }
      });
    });
  });

  describe('verifyWithReplayGuard', () => {
    let cache: CacheService;
    let svc: TotpService;

    beforeEach(async () => {
      cache = makeCache();
      await (cache as unknown as { client: { flushall: () => Promise<void> } }).client.flushall();
      svc = new TotpService(cache);
    });

    it('accepts a valid code on first presentation', async () => {
      const secret = svc.generateSecret();
      const code = authenticator.generate(secret);
      await expect(svc.verifyWithReplayGuard(42, code, secret, { scope: 'u' })).resolves.toBe(true);
    });

    it('REPLAY: same code within 90s is rejected', async () => {
      const secret = svc.generateSecret();
      const code = authenticator.generate(secret);
      await expect(svc.verifyWithReplayGuard(42, code, secret, { scope: 'u' })).resolves.toBe(true);
      // Immediate replay.
      await expect(svc.verifyWithReplayGuard(42, code, secret, { scope: 'u' })).resolves.toBe(
        false,
      );
    });

    it('different valid codes (same user) each get their own Redis slot', async () => {
      const secret = svc.generateSecret();
      const firstCode = authenticator.generate(secret);
      // Advance the clock past a TOTP step so a different code is generated.
      const realNow = Date.now;
      try {
        Date.now = () => realNow() + 31 * 1000;
        const secondCode = authenticator.generate(secret);
        Date.now = realNow;

        expect(firstCode).not.toBe(secondCode);
        await expect(
          svc.verifyWithReplayGuard(42, firstCode, secret, { scope: 'u' }),
        ).resolves.toBe(true);
        // The *second* code is rejected purely because the current step
        // doesn't match — but that's not replay; it's stepwise verify.
        // Replay-guard is exercised by the same-user-same-code case above.
        // Here the important invariant is the key space is per-code: a
        // different code re-uses no state.
        const usedKey = `used-totp:u:42:${firstCode}`;
        const secondKey = `used-totp:u:42:${secondCode}`;
        const client = (cache as unknown as { client: { exists: (k: string) => Promise<number> } })
          .client;
        expect(await client.exists(usedKey)).toBe(1);
        expect(await client.exists(secondKey)).toBe(0);
      } finally {
        Date.now = realNow;
      }
    });

    it('admin vs customer scope do not collide (separate Redis key namespaces)', async () => {
      const secret = svc.generateSecret();
      const code = authenticator.generate(secret);

      await expect(svc.verifyWithReplayGuard(7, code, secret, { scope: 'a' })).resolves.toBe(true);
      // Same numeric id under customer scope — a separate user happens to share
      // the userId integer space. Replay-guard must not lock them out.
      await expect(svc.verifyWithReplayGuard(7, code, secret, { scope: 'u' })).resolves.toBe(true);
    });

    it('rejects an invalid code without consulting Redis', async () => {
      const secret = svc.generateSecret();
      const setNx = jest.spyOn(cache, 'setNx');
      await expect(svc.verifyWithReplayGuard(1, '000000', secret, { scope: 'u' })).resolves.toBe(
        false,
      );
      expect(setNx).not.toHaveBeenCalled();
    });

    it('Redis outage → fail-CLOSED by default (admin-style)', async () => {
      jest.spyOn(cache, 'setNx').mockRejectedValue(new Error('ECONNREFUSED'));
      const secret = svc.generateSecret();
      const code = authenticator.generate(secret);
      await expect(svc.verifyWithReplayGuard(9, code, secret, { scope: 'a' })).resolves.toBe(false);
    });

    it('Redis outage with failOpen=true → accept (opt-in only)', async () => {
      jest.spyOn(cache, 'setNx').mockRejectedValue(new Error('ECONNREFUSED'));
      const secret = svc.generateSecret();
      const code = authenticator.generate(secret);
      await expect(
        svc.verifyWithReplayGuard(9, code, secret, { scope: 'u', failOpen: true }),
      ).resolves.toBe(true);
    });

    it('with no CacheService wired at all → fail-CLOSED', async () => {
      const noCacheSvc = new TotpService();
      const secret = noCacheSvc.generateSecret();
      const code = authenticator.generate(secret);
      await expect(noCacheSvc.verifyWithReplayGuard(1, code, secret, { scope: 'a' })).resolves.toBe(
        false,
      );
    });
  });
});
