process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48);
process.env.JWT_CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);
process.env.JWT_ACCESS_TOKEN_EXPIRATION = process.env.JWT_ACCESS_TOKEN_EXPIRATION ?? '15m';

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
    limit: jest.fn().mockImplementation(() => Promise.resolve(state.terminals.limit ?? state.default)),
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
    twoFactorEnabled: false,
    twoFactorSecret: null,
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
      validateAndRotate: jest.fn().mockResolvedValue('a:1:rotated'),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeAll: jest.fn().mockResolvedValue(undefined),
    } as any;
    totp = {
      verify: jest.fn().mockReturnValue(true),
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
      await expect(svc.login({ email: 'admin@example.com', password: 'pw' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws ForbiddenException on inactive account', async () => {
      deps.selectBuilder.__setTerminal('limit', [baseAdmin({ accessStatus: 'INACTIVE' })]);
      await expect(svc.login({ email: 'admin@example.com', password: 'pw' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('returns { requires2fa: true } when 2FA enabled and no code supplied', async () => {
      deps.selectBuilder.__setTerminal('limit', [
        baseAdmin({ twoFactorEnabled: true, twoFactorSecret: 'SEC' }),
      ]);
      await expect(
        svc.login({ email: 'admin@example.com', password: 'pw' }),
      ).resolves.toEqual({ requires2fa: true });
    });

    it('throws UnauthorizedException on invalid totpCode', async () => {
      deps.selectBuilder.__setTerminal('limit', [
        baseAdmin({ twoFactorEnabled: true, twoFactorSecret: 'SEC' }),
      ]);
      totp.verify.mockReturnValue(false);
      await expect(
        svc.login({ email: 'admin@example.com', password: 'pw', totpCode: '000000' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('issues access+refresh tokens on success', async () => {
      const admin = baseAdmin();
      deps.selectBuilder.__setTerminal('limit', [admin]);
      const result = await svc.login({ email: admin.email, password: 'pw' });
      expect(jwt.signAdmin).toHaveBeenCalledWith({ adminId: admin.id, email: admin.email });
      expect(refresh.create).toHaveBeenCalledWith('a', admin.id);
      expect(result).toMatchObject({
        admin: { id: admin.id, email: admin.email, name: admin.name },
        accessToken: 'admin.jwt',
        refreshToken: 'a:1:abcd',
      });
    });

    it('issues tokens after valid totpCode', async () => {
      const admin = baseAdmin({ twoFactorEnabled: true, twoFactorSecret: 'SEC' });
      deps.selectBuilder.__setTerminal('limit', [admin]);
      const result = await svc.login({
        email: admin.email,
        password: 'pw',
        totpCode: '123456',
      });
      expect(totp.verify).toHaveBeenCalledWith('123456', 'SEC');
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
      refresh.validateAndRotate.mockResolvedValue('a:3:rotated');

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
