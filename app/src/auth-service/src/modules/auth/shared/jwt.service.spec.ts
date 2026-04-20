// Seed required env BEFORE importing anything that triggers config/environment parsing.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48) /* >= 32 chars */;
process.env.JWT_CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);
process.env.JWT_ACCESS_TOKEN_EXPIRATION = process.env.JWT_ACCESS_TOKEN_EXPIRATION ?? '15m';

import { JwtService as NestJwtService } from '@nestjs/jwt';
import { JwtService } from './jwt.service';
import type { AccessTokenClaims } from '@app/contracts';

describe('JwtService — OIDC-shaped access tokens', () => {
  const nest = new NestJwtService({});
  const svc = new JwtService(nest);

  const adminClaims: Omit<AccessTokenClaims, 'iat' | 'exp'> = {
    sub: 'a:42',
    type: 'admin',
    email: 'admin@example.com',
    scopes: [],
  };
  const userClaims: Omit<AccessTokenClaims, 'iat' | 'exp'> = {
    sub: 'u:7',
    type: 'user',
    email: 'user@example.com',
    name: 'Alice',
    scopes: ['read:profile', 'read:dashboard'],
  };

  describe('admin tokens', () => {
    it('signs + verifies with JWT_ADMIN_SECRET, preserves OIDC payload shape', () => {
      const token = svc.signAdmin(adminClaims);
      const decoded = svc.verifyAdmin(token);
      expect(decoded.sub).toBe('a:42');
      expect(decoded.type).toBe('admin');
      expect(decoded.email).toBe(adminClaims.email);
      expect(decoded.scopes).toEqual([]);
      expect(typeof decoded.iat).toBe('number');
      expect(typeof decoded.exp).toBe('number');
      expect(decoded.exp!).toBeGreaterThan(decoded.iat!);
    });

    it('rejects admin token verified with the customer path (different secret)', () => {
      const token = svc.signAdmin(adminClaims);
      expect(() => svc.verifyUser(token)).toThrow();
    });

    it('rejects sub that does not look like an admin (a:...) principal', () => {
      // The signer should not mint admin tokens with a user-style sub.
      expect(() => svc.signAdmin({ ...adminClaims, sub: 'u:42' as never })).toThrow(/admin/i);
    });
  });

  describe('user tokens', () => {
    it('signs + verifies with JWT_CUSTOMER_SECRET, preserves OIDC payload shape', () => {
      const token = svc.signUser(userClaims);
      const decoded = svc.verifyUser(token);
      expect(decoded.sub).toBe('u:7');
      expect(decoded.type).toBe('user');
      expect(decoded.email).toBe(userClaims.email);
      expect(decoded.name).toBe(userClaims.name);
      expect(decoded.scopes).toEqual(userClaims.scopes);
      expect(typeof decoded.iat).toBe('number');
      expect(typeof decoded.exp).toBe('number');
    });

    it('rejects user token verified with the admin path (different secret)', () => {
      const token = svc.signUser(userClaims);
      expect(() => svc.verifyAdmin(token)).toThrow();
    });

    it('rejects sub that does not look like a user (u:...) principal', () => {
      expect(() => svc.signUser({ ...userClaims, sub: 'a:7' as never })).toThrow(/user/i);
    });
  });

  describe('expiration', () => {
    it('throws a TokenExpiredError when verifying past exp', () => {
      jest.useFakeTimers();
      try {
        const base = new Date('2026-01-01T00:00:00Z').getTime();
        jest.setSystemTime(base);
        const token = svc.signUser(userClaims);

        jest.setSystemTime(base + 16 * 60 * 1000);
        expect(() => svc.verifyUser(token)).toThrow(/jwt expired|expired/i);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
