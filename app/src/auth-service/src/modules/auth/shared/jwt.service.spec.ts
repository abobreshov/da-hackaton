// Seed required env BEFORE importing anything that triggers config/environment parsing.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET =
  process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48) /* >= 32 chars */;
process.env.JWT_CUSTOMER_SECRET =
  process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);
process.env.JWT_ACCESS_TOKEN_EXPIRATION = process.env.JWT_ACCESS_TOKEN_EXPIRATION ?? '15m';

import { JwtService as NestJwtService } from '@nestjs/jwt';
import { JwtService, AdminJwtPayload, UserJwtPayload } from './jwt.service';

describe('JwtService', () => {
  const nest = new NestJwtService({});
  const svc = new JwtService(nest);

  const adminPayload: Omit<AdminJwtPayload, 'iat' | 'exp'> = {
    adminId: 42,
    email: 'admin@example.com',
  };
  const userPayload: Omit<UserJwtPayload, 'iat' | 'exp'> = {
    userId: 7,
    email: 'user@example.com',
    role: 'user',
    scopes: ['read'],
  };

  describe('admin tokens', () => {
    it('signs and verifies with JWT_ADMIN_SECRET, preserving payload shape', () => {
      const token = svc.signAdmin(adminPayload);
      const decoded = svc.verifyAdmin(token);
      expect(decoded.adminId).toBe(adminPayload.adminId);
      expect(decoded.email).toBe(adminPayload.email);
      expect(typeof decoded.iat).toBe('number');
      expect(typeof decoded.exp).toBe('number');
      expect(decoded.exp!).toBeGreaterThan(decoded.iat!);
    });

    it('rejects admin token verified with the customer path (different secret)', () => {
      const token = svc.signAdmin(adminPayload);
      expect(() => svc.verifyUser(token)).toThrow();
    });
  });

  describe('user tokens', () => {
    it('signs and verifies with JWT_CUSTOMER_SECRET, preserving payload shape', () => {
      const token = svc.signUser(userPayload);
      const decoded = svc.verifyUser(token);
      expect(decoded.userId).toBe(userPayload.userId);
      expect(decoded.email).toBe(userPayload.email);
      expect(decoded.role).toBe(userPayload.role);
      expect(decoded.scopes).toEqual(userPayload.scopes);
      expect(typeof decoded.iat).toBe('number');
      expect(typeof decoded.exp).toBe('number');
    });

    it('rejects user token verified with the admin path (different secret)', () => {
      const token = svc.signUser(userPayload);
      expect(() => svc.verifyAdmin(token)).toThrow();
    });
  });

  describe('expiration', () => {
    it('throws a TokenExpiredError when verifying past exp', () => {
      jest.useFakeTimers();
      try {
        // Freeze the clock BEFORE signing so exp is deterministic.
        const base = new Date('2026-01-01T00:00:00Z').getTime();
        jest.setSystemTime(base);
        const token = svc.signUser(userPayload);

        // Advance beyond 15 minutes.
        jest.setSystemTime(base + 16 * 60 * 1000);
        expect(() => svc.verifyUser(token)).toThrow(/jwt expired|expired/i);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
