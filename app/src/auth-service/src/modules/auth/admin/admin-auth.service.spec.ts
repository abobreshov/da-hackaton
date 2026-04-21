process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48);
process.env.JWT_CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);
process.env.JWT_ACCESS_TOKEN_EXPIRATION = process.env.JWT_ACCESS_TOKEN_EXPIRATION ?? '15m';
// Default for the suite: admin accounts must have 2FA. Individual tests that
// exercise the dev escape hatch flip this before importing the service via
// jest.resetModules() below.
process.env.ALLOW_PASSWORD_ONLY_ADMIN_LOGIN =
  process.env.ALLOW_PASSWORD_ONLY_ADMIN_LOGIN ?? 'false';

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import type { PasswordService } from '../shared/password.service';
import type { JwtService } from '../shared/jwt.service';
import type { RefreshTokenService } from '../shared/refresh-token.service';
import type { TotpService } from '../shared/totp.service';

function builder(defaultResult: unknown = undefined) {
  const state: { terminals: Record<string, unknown>; default: unknown } = {
    terminals: {},
    default: defaultResult,
  };
  const thenable: any = {
    from: jest.fn().mockImplementation(() => thenable),
    where: jest.fn().mockImplementation(() => thenable),
    limit: jest
      .fn()
      .mockImplementation(() => Promise.resolve(state.terminals.limit ?? state.default)),
    __setTerminal: (name: string, value: unknown) => {
      state.terminals[name] = value;
      return thenable;
    },
  };
  return thenable;
}

function makeDb() {
  const selectBuilder = builder([]);
  const select = jest.fn().mockReturnValue(selectBuilder);
  return { db: { select } as any, selectBuilder, select };
}

function baseAdmin(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: 'admin@example.com',
    name: 'admin',
    passwordHash: 'hashed',
    twoFactorEnabled: true,
    twoFactorSecret: 'SEC',
    accessStatus: 'ACTIVE',
    ...overrides,
  };
}

describe('AdminAuthService', () => {
  let svc: AdminAuthService;
  let deps: ReturnType<typeof makeDb>;
  let pw: jest.Mocked<PasswordService>;
  let jwt: jest.Mocked<JwtService>;
  let refresh: jest.Mocked<RefreshTokenService>;
  let totp: jest.Mocked<TotpService>;

  beforeEach(() => {
    deps = makeDb();
    pw = { hash: jest.fn(), compare: jest.fn().mockResolvedValue(true) } as any;
    jwt = {
      signAdmin: jest.fn().mockReturnValue('admin.jwt'),
      signUser: jest.fn(),
      verifyAdmin: jest.fn(),
      verifyUser: jest.fn(),
    } as any;
    refresh = {
      create: jest.fn().mockResolvedValue('a:1:abcd'),
      validateAndRotate: jest.fn().mockResolvedValue({ token: 'a:1:rotated' }),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeAll: jest.fn().mockResolvedValue(undefined),
    } as any;
    totp = {
      verify: jest.fn().mockReturnValue(true),
      verifyWithReplayGuard: jest.fn().mockResolvedValue(true),
      generateSecret: jest.fn(),
      generateQrCode: jest.fn(),
    } as any;
    svc = new AdminAuthService(deps.db, pw, jwt, refresh, totp);
  });

  describe('login', () => {
    it('throws UnauthorizedException when admin not found', async () => {
      deps.selectBuilder.__setTerminal('limit', []);
      await expect(svc.login({ email: 'x@x.com', password: 'pw' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException on password mismatch', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseAdmin()]);
      pw.compare.mockResolvedValue(false);
      await expect(
        svc.login({ email: 'admin@example.com', password: 'pw' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws ForbiddenException on inactive account', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseAdmin({ accessStatus: 'INACTIVE' })]);
      await expect(
        svc.login({ email: 'admin@example.com', password: 'pw' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // ---- Fix 3 — admin TOTP enforcement ----

    it('refuses login when admin has twoFactorEnabled=false (OWASP A07)', async () => {
      deps.selectBuilder.__setTerminal('limit', [
        baseAdmin({ twoFactorEnabled: false, twoFactorSecret: null }),
      ]);
      const promise = svc.login({ email: 'admin@example.com', password: 'pw' });
      await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(promise).rejects.toThrow(/two-factor authentication/i);
      expect(refresh.create).not.toHaveBeenCalled();
      expect(jwt.signAdmin).not.toHaveBeenCalled();
    });

    it('returns { requires2fa: true } when 2FA enabled and no code supplied', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseAdmin()]);
      await expect(svc.login({ email: 'admin@example.com', password: 'pw' })).resolves.toEqual({
        requires2fa: true,
      });
    });

    it('throws UnauthorizedException on invalid totpCode', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseAdmin()]);
      totp.verifyWithReplayGuard.mockResolvedValue(false);
      await expect(
        svc.login({ email: 'admin@example.com', password: 'pw', totpCode: '000000' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('uses verifyWithReplayGuard (scope=a, fail-closed) for admin TOTP checks', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseAdmin()]);
      await svc.login({ email: 'admin@example.com', password: 'pw', totpCode: '123456' });
      expect(totp.verifyWithReplayGuard).toHaveBeenCalledWith(
        1,
        '123456',
        'SEC',
        expect.objectContaining({ scope: 'a' }),
      );
    });

    it('issues tokens after valid totpCode', async () => {
      const admin = baseAdmin();
      deps.selectBuilder.__setTerminal('limit', [admin]);
      const result = await svc.login({
        email: admin.email,
        password: 'pw',
        totpCode: '123456',
      });
      expect(totp.verifyWithReplayGuard).toHaveBeenCalledWith(
        admin.id,
        '123456',
        'SEC',
        expect.objectContaining({ scope: 'a' }),
      );
      expect(result).toMatchObject({ accessToken: 'admin.jwt' });
    });
  });

  describe('refresh', () => {
    it('throws UnauthorizedException on malformed (too few parts) token', async () => {
      await expect(svc.refresh('a:1')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when token prefix is not "a"', async () => {
      await expect(svc.refresh('u:1:abcd')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when admin missing / inactive', async () => {
      deps.selectBuilder.__setTerminal('limit', []);
      await expect(svc.refresh('a:1:abcd')).rejects.toBeInstanceOf(UnauthorizedException);

      deps.selectBuilder.__setTerminal('limit', [baseAdmin({ accessStatus: 'INACTIVE' })]);
      await expect(svc.refresh('a:1:abcd')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rotates the refresh token and issues a fresh access token', async () => {
      const admin = baseAdmin({ id: 3 });
      deps.selectBuilder.__setTerminal('limit', [admin]);
      refresh.validateAndRotate.mockResolvedValue({ token: 'a:3:rotated' } as any);

      const result = await svc.refresh('a:3:abcd');
      expect(refresh.validateAndRotate).toHaveBeenCalledWith('a', 3, 'a:3:abcd');
      expect(result).toMatchObject({
        accessToken: 'admin.jwt',
        refreshToken: 'a:3:rotated',
        admin: { id: 3, email: admin.email },
      });
    });
  });

  describe('logout', () => {
    it('no-ops on malformed token', async () => {
      await expect(svc.logout('bad')).resolves.toBeUndefined();
      expect(refresh.revoke).not.toHaveBeenCalled();
    });

    it('no-ops on customer-shaped token (prefix "u")', async () => {
      await expect(svc.logout('u:1:abcd')).resolves.toBeUndefined();
      expect(refresh.revoke).not.toHaveBeenCalled();
    });

    it('revokes the matching refresh token for a valid admin token', async () => {
      await svc.logout('a:7:abcdef');
      expect(refresh.revoke).toHaveBeenCalledWith('a', 7, 'a:7:abcdef');
    });
  });
});

// Separate describe block: flips the env escape-hatch before importing the
// service so the zod-parsed `env` sees the override. Uses jest.isolateModules
// to re-run config parsing in a fresh module registry.
describe('AdminAuthService — ALLOW_PASSWORD_ONLY_ADMIN_LOGIN escape hatch', () => {
  it('permits password-only admin login when the flag is true', async () => {
    const prev = process.env.ALLOW_PASSWORD_ONLY_ADMIN_LOGIN;
    process.env.ALLOW_PASSWORD_ONLY_ADMIN_LOGIN = 'true';
    try {
      let svc: AdminAuthService;
      let deps: ReturnType<typeof makeDb>;
      await jest.isolateModulesAsync(async () => {
        const { AdminAuthService: Fresh } = await import('./admin-auth.service');
        deps = makeDb();
        const pw = { hash: jest.fn(), compare: jest.fn().mockResolvedValue(true) } as any;
        const jwtSvc = {
          signAdmin: jest.fn().mockReturnValue('admin.jwt'),
          signUser: jest.fn(),
          verifyAdmin: jest.fn(),
          verifyUser: jest.fn(),
        } as any;
        const refresh = {
          create: jest.fn().mockResolvedValue('a:1:abcd'),
          validateAndRotate: jest.fn(),
          revoke: jest.fn(),
          revokeAll: jest.fn(),
        } as any;
        const totp = {
          verify: jest.fn(),
          verifyWithReplayGuard: jest.fn(),
          generateSecret: jest.fn(),
          generateQrCode: jest.fn(),
        } as any;
        svc = new Fresh(deps.db, pw, jwtSvc, refresh, totp);
        deps.selectBuilder.__setTerminal('limit', [
          baseAdmin({ twoFactorEnabled: false, twoFactorSecret: null }),
        ]);
        const result = await svc.login({ email: 'admin@example.com', password: 'pw' });
        expect(result).toMatchObject({ accessToken: 'admin.jwt' });
        expect(totp.verifyWithReplayGuard).not.toHaveBeenCalled();
      });
    } finally {
      process.env.ALLOW_PASSWORD_ONLY_ADMIN_LOGIN = prev;
    }
  });
});
