/**
 * SessionGuard covers the fast-path (valid session cookie) and slow-path
 * (expired session → auth-service refresh via TCP → rotate cookies).
 */
jest.mock('../config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    SYSTEM_KEY: 'test-sys-key',
    TLS_ENABLED: false,
    SESSION_COOKIE_SECRET: 's'.repeat(32),
    SESSION_COOKIE_TTL: 900,
    REFRESH_COOKIE_TTL: 604_800,
  },
}));

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SessionGuard } from './session.guard';

function makeCtx(req: any, reply: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => reply,
    }),
  } as unknown as ExecutionContext;
}

function makeCookieService() {
  return {
    readSessionCookie: jest.fn(),
    readRefreshCookie: jest.fn(),
    verifySession: jest.fn(),
    setSessionCookie: jest.fn(),
    setRefreshCookie: jest.fn(),
    clearCookies: jest.fn(),
  } as any;
}

function makeAuthService() {
  return {
    refreshAdmin: jest.fn(),
    refreshUser: jest.fn(),
  } as any;
}

describe('SessionGuard', () => {
  let cookieSvc: ReturnType<typeof makeCookieService>;
  let authSvc: ReturnType<typeof makeAuthService>;
  let guard: SessionGuard;

  beforeEach(() => {
    cookieSvc = makeCookieService();
    authSvc = makeAuthService();
    guard = new SessionGuard(cookieSvc, authSvc);
  });

  describe('fast-path — valid session cookie', () => {
    it('verifies cookie, attaches req.session, returns true', async () => {
      const payload = {
        sub: 'u:7',
        email: 'a@b.com',
        name: 'alice',
        type: 'user',
        scopes: ['chat'],
      };
      cookieSvc.readSessionCookie.mockReturnValue('inner-jwt');
      cookieSvc.verifySession.mockReturnValue(payload);

      const req: any = {};
      const reply: any = {};
      await expect(guard.canActivate(makeCtx(req, reply))).resolves.toBe(true);

      expect(req.session).toEqual(payload);
      expect(cookieSvc.readRefreshCookie).not.toHaveBeenCalled();
      expect(authSvc.refreshUser).not.toHaveBeenCalled();
      expect(authSvc.refreshAdmin).not.toHaveBeenCalled();
    });
  });

  describe('missing cookies', () => {
    it('throws 401 when neither session nor refresh cookie is present', async () => {
      cookieSvc.readSessionCookie.mockReturnValue(null);
      cookieSvc.readRefreshCookie.mockReturnValue(null);

      await expect(guard.canActivate(makeCtx({}, {}))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(authSvc.refreshUser).not.toHaveBeenCalled();
      expect(authSvc.refreshAdmin).not.toHaveBeenCalled();
    });

    it('throws 401 when session cookie is invalid and refresh is missing', async () => {
      cookieSvc.readSessionCookie.mockReturnValue('stale-jwt');
      cookieSvc.verifySession.mockReturnValue(null); // invalid signature / expired
      cookieSvc.readRefreshCookie.mockReturnValue(null);

      await expect(guard.canActivate(makeCtx({}, {}))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('slow-path — user refresh', () => {
    it('invalid JWT → refreshUser → reissues both cookies + sets req.session', async () => {
      cookieSvc.readSessionCookie.mockReturnValue('stale-jwt');
      cookieSvc.verifySession.mockReturnValue(null);
      cookieSvc.readRefreshCookie.mockReturnValue('u:old-refresh');

      const fresh = {
        user: { id: 7, email: 'a@b.com', name: 'alice', scopes: ['chat'] },
        refreshToken: 'u:new-refresh',
      };
      authSvc.refreshUser.mockResolvedValue(fresh);

      const req: any = {};
      const reply: any = {};
      await expect(guard.canActivate(makeCtx(req, reply))).resolves.toBe(true);

      expect(authSvc.refreshUser).toHaveBeenCalledWith('u:old-refresh');
      expect(authSvc.refreshAdmin).not.toHaveBeenCalled();
      expect(cookieSvc.setSessionCookie).toHaveBeenCalledWith(reply, {
        sub: 'u:7',
        email: 'a@b.com',
        name: 'alice',
        type: 'user',
        scopes: ['chat'],
      });
      expect(cookieSvc.setRefreshCookie).toHaveBeenCalledWith(reply, 'u:new-refresh');
      expect(req.session).toEqual({
        sub: 'u:7',
        email: 'a@b.com',
        name: 'alice',
        type: 'user',
        scopes: ['chat'],
      });
    });

    it('defaults scopes to [] when upstream user has none', async () => {
      cookieSvc.readSessionCookie.mockReturnValue(null);
      cookieSvc.readRefreshCookie.mockReturnValue('u:rt');
      authSvc.refreshUser.mockResolvedValue({
        user: { id: 1, email: 'b@c', name: 'b' },
        refreshToken: 'u:rt2',
      });

      const req: any = {};
      const reply: any = {};
      await guard.canActivate(makeCtx(req, reply));

      expect(req.session.scopes).toEqual([]);
      expect(cookieSvc.setSessionCookie).toHaveBeenCalledWith(
        reply,
        expect.objectContaining({ scopes: [] }),
      );
    });

    it('returns 401 + clears cookies when refreshUser throws', async () => {
      cookieSvc.readSessionCookie.mockReturnValue(null);
      cookieSvc.readRefreshCookie.mockReturnValue('u:bad-refresh');
      authSvc.refreshUser.mockRejectedValue(new Error('rpc refused'));

      const reply: any = {};
      await expect(guard.canActivate(makeCtx({}, reply))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(cookieSvc.clearCookies).toHaveBeenCalledWith(reply);
    });
  });

  describe('slow-path — admin refresh', () => {
    it('refresh token "a:" prefix → refreshAdmin → reissues cookies', async () => {
      cookieSvc.readSessionCookie.mockReturnValue(null);
      cookieSvc.readRefreshCookie.mockReturnValue('a:admin-refresh');
      authSvc.refreshAdmin.mockResolvedValue({
        admin: { id: 1, email: 'ad@x', name: 'ad' },
        refreshToken: 'a:new',
      });

      const req: any = {};
      const reply: any = {};
      await expect(guard.canActivate(makeCtx(req, reply))).resolves.toBe(true);

      expect(authSvc.refreshAdmin).toHaveBeenCalledWith('a:admin-refresh');
      expect(authSvc.refreshUser).not.toHaveBeenCalled();
      expect(cookieSvc.setSessionCookie).toHaveBeenCalledWith(reply, {
        sub: 'a:1',
        email: 'ad@x',
        name: 'ad',
        type: 'admin',
        scopes: [],
      });
      expect(cookieSvc.setRefreshCookie).toHaveBeenCalledWith(reply, 'a:new');
      expect(req.session.type).toBe('admin');
      expect(req.session.sub).toBe('a:1');
    });

    it('returns 401 + clears cookies when refreshAdmin throws', async () => {
      cookieSvc.readSessionCookie.mockReturnValue(null);
      cookieSvc.readRefreshCookie.mockReturnValue('a:bad');
      authSvc.refreshAdmin.mockRejectedValue(new Error('rpc down'));

      const reply: any = {};
      await expect(guard.canActivate(makeCtx({}, reply))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(cookieSvc.clearCookies).toHaveBeenCalledWith(reply);
    });
  });
});
