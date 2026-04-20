// Stub env so transitive imports (auth.service → microservice.module → environment)
// don't require real secrets at test time.
jest.mock('../config/environment', () => ({
  env: {
    SYSTEM_KEY: 'test-sys-key',
    TLS_ENABLED: false,
    BACKEND_TCP_HOST: '127.0.0.1',
    BACKEND_TCP_PORT: 4004,
    AUTH_TCP_HOST: '127.0.0.1',
    AUTH_TCP_PORT: 4003,
    NODE_ENV: 'test',
    SESSION_COOKIE_TTL: 900,
    REFRESH_COOKIE_TTL: 2_592_000,
    SESSION_COOKIE_SECRET: 'test-session-secret',
  },
}));

import { RpcException } from '@nestjs/microservices';
import { AuthController } from './auth.controller';

function makeCookieServiceMock() {
  const svc: any = {
    setSessionCookie: jest.fn(),
    setRefreshCookie: jest.fn(),
    readRefreshCookie: jest.fn(),
    clearCookies: jest.fn(),
  };
  // Helper delegates to the two setters — mirror that so assertions on the
  // individual setters still fire when controller calls the helper.
  svc.issueAuthCookies = jest.fn((reply: any, args: any) => {
    svc.setSessionCookie(reply, args.session);
    svc.setRefreshCookie(reply, args.refreshToken);
  });
  return svc;
}

function makeAuthServiceMock() {
  return {
    loginUser: jest.fn(),
    loginAdmin: jest.fn(),
    register: jest.fn(),
    passwordResetRequest: jest.fn(),
    passwordResetConfirm: jest.fn(),
    passwordChange: jest.fn(),
    deleteAccount: jest.fn(),
    logoutUser: jest.fn(),
    logoutAdmin: jest.fn(),
  } as any;
}

function makeReply() {
  return {
    setCookie: jest.fn(),
    clearCookie: jest.fn(),
    // plugin-provided @fastify/csrf-protection method; generateCsrf is the
    // primary shape (stable since fastify/csrf-protection 7). Tests assert both
    // call-sites: reply.generateCsrf() and the fallback via req.server.
    generateCsrf: jest.fn().mockReturnValue('csrf-token-xyz'),
  };
}

describe('AuthController — new endpoints', () => {
  let controller: AuthController;
  let authSvc: ReturnType<typeof makeAuthServiceMock>;
  let cookieSvc: ReturnType<typeof makeCookieServiceMock>;

  beforeEach(() => {
    authSvc = makeAuthServiceMock();
    cookieSvc = makeCookieServiceMock();
    controller = new AuthController(authSvc, cookieSvc);
  });

  describe('POST /auth/register', () => {
    it('proxies {email,username,password} to auth-service and sets session cookies on success', async () => {
      const user = { id: 42, email: 'a@b.com', name: 'alice', scopes: ['chat'] };
      const refreshToken = 'refresh-xyz';
      authSvc.register.mockResolvedValue({ user, refreshToken });

      const reply = makeReply();
      const body = await controller.register(
        { email: 'a@b.com', username: 'alice', password: 'pw12345678' } as any,
        reply as any,
      );

      expect(authSvc.register).toHaveBeenCalledWith('a@b.com', 'alice', 'pw12345678');
      expect(cookieSvc.setSessionCookie).toHaveBeenCalledWith(reply, {
        userId: 42,
        email: 'a@b.com',
        name: 'alice',
        type: 'user',
        scopes: ['chat'],
      });
      expect(cookieSvc.setRefreshCookie).toHaveBeenCalledWith(reply, refreshToken);
      expect(body).toEqual({ user });
    });

    it('propagates upstream RpcException (duplicate email → CONFLICT)', async () => {
      const rpc = new RpcException({ status: 409, message: 'email already registered' });
      authSvc.register.mockRejectedValue(rpc);

      const reply = makeReply();
      await expect(
        controller.register(
          { email: 'dup@b.com', username: 'dup', password: 'pw12345678' } as any,
          reply as any,
        ),
      ).rejects.toBe(rpc);
      expect(cookieSvc.setSessionCookie).not.toHaveBeenCalled();
      expect(cookieSvc.setRefreshCookie).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/password-reset/request', () => {
    it('proxies {email} to auth-service and returns void (204)', async () => {
      authSvc.passwordResetRequest.mockResolvedValue(undefined);
      const res = await controller.passwordResetRequest({ email: 'a@b.com' } as any);
      expect(authSvc.passwordResetRequest).toHaveBeenCalledWith('a@b.com');
      expect(res).toBeUndefined();
    });

    it('still returns void even when upstream signals unknown-email (enumeration guard)', async () => {
      // Upstream is expected to respond 204-equivalent for unknown email, but
      // the BFF must not leak. This test guarantees the controller is a plain
      // proxy and does not branch on resolved value.
      authSvc.passwordResetRequest.mockResolvedValue(undefined);
      await expect(
        controller.passwordResetRequest({ email: 'nobody@b.com' } as any),
      ).resolves.toBeUndefined();
    });
  });

  describe('POST /auth/password-reset/confirm', () => {
    it('proxies {token,newPassword} and returns void (204)', async () => {
      authSvc.passwordResetConfirm.mockResolvedValue(undefined);
      const res = await controller.passwordResetConfirm({
        token: 'token-abcdefghijklmnop',
        newPassword: 'newPass1234',
      } as any);
      expect(authSvc.passwordResetConfirm).toHaveBeenCalledWith(
        'token-abcdefghijklmnop',
        'newPass1234',
      );
      expect(res).toBeUndefined();
    });

    it('propagates RpcException for invalid/expired token', async () => {
      const rpc = new RpcException({ status: 400, message: 'invalid token' });
      authSvc.passwordResetConfirm.mockRejectedValue(rpc);
      await expect(
        controller.passwordResetConfirm({
          token: 'bad-token-xxxxxxxxxxxx',
          newPassword: 'newPass1234',
        } as any),
      ).rejects.toBe(rpc);
    });
  });

  describe('POST /auth/password-change (session-guarded)', () => {
    it('proxies {userId,currentPassword,newPassword} and returns void (204)', async () => {
      authSvc.passwordChange.mockResolvedValue(undefined);
      const req: any = { session: { userId: 7, type: 'user' } };
      const res = await controller.passwordChange(
        { currentPassword: 'old12345', newPassword: 'new12345' } as any,
        req,
      );
      expect(authSvc.passwordChange).toHaveBeenCalledWith(7, 'old12345', 'new12345');
      expect(res).toBeUndefined();
    });

    it('propagates wrong-current-password as RpcException', async () => {
      const rpc = new RpcException({ status: 401, message: 'current password invalid' });
      authSvc.passwordChange.mockRejectedValue(rpc);
      const req: any = { session: { userId: 7, type: 'user' } };
      await expect(
        controller.passwordChange(
          { currentPassword: 'wrong123', newPassword: 'new12345' } as any,
          req,
        ),
      ).rejects.toBe(rpc);
    });
  });

  describe('DELETE /auth/account (session-guarded)', () => {
    it('proxies to auth-service delete, clears cookies, returns void (204)', async () => {
      authSvc.deleteAccount.mockResolvedValue(undefined);
      const reply = makeReply();
      const req: any = { session: { userId: 42, type: 'user' } };
      const res = await controller.deleteAccount(req, reply as any);
      expect(authSvc.deleteAccount).toHaveBeenCalledWith(42);
      expect(cookieSvc.clearCookies).toHaveBeenCalledWith(reply);
      expect(res).toBeUndefined();
    });

    it('does NOT clear cookies if upstream delete fails', async () => {
      const rpc = new RpcException({ status: 500, message: 'db down' });
      authSvc.deleteAccount.mockRejectedValue(rpc);
      const reply = makeReply();
      const req: any = { session: { userId: 42, type: 'user' } };
      await expect(controller.deleteAccount(req, reply as any)).rejects.toBe(rpc);
      expect(cookieSvc.clearCookies).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/login', () => {
    it('user login success → issues session cookies and echoes user', async () => {
      const user = { id: 7, email: 'a@b.com', name: 'alice', scopes: ['chat'] };
      const refreshToken = 'u:refresh';
      authSvc.loginUser.mockResolvedValue({ user, refreshToken });

      const reply = makeReply();
      const body = await controller.login(
        { email: 'a@b.com', password: 'pw12345678', type: 'user' } as any,
        {} as any,
        reply as any,
      );

      expect(authSvc.loginUser).toHaveBeenCalledWith('a@b.com', 'pw12345678', undefined);
      expect(cookieSvc.setSessionCookie).toHaveBeenCalledWith(reply, {
        userId: 7,
        email: 'a@b.com',
        name: 'alice',
        type: 'user',
        scopes: ['chat'],
      });
      expect(cookieSvc.setRefreshCookie).toHaveBeenCalledWith(reply, refreshToken);
      expect(body).toEqual({ user });
    });

    it('user login → defaults scopes to [] when upstream omits them', async () => {
      authSvc.loginUser.mockResolvedValue({
        user: { id: 1, email: 'x', name: 'x' },
        refreshToken: 'u:r',
      });
      const reply = makeReply();
      await controller.login(
        { email: 'x@y.z', password: 'pw12345678', type: 'user' } as any,
        {} as any,
        reply as any,
      );
      expect(cookieSvc.setSessionCookie).toHaveBeenCalledWith(
        reply,
        expect.objectContaining({ scopes: [] }),
      );
    });

    it('user login requiring 2FA → returns {requires2fa:true} and does NOT set cookies', async () => {
      authSvc.loginUser.mockResolvedValue({ requires2fa: true });
      const reply = makeReply();
      const body = await controller.login(
        { email: 'a@b.com', password: 'pw12345678', type: 'user' } as any,
        {} as any,
        reply as any,
      );
      expect(body).toEqual({ requires2fa: true });
      expect(cookieSvc.setSessionCookie).not.toHaveBeenCalled();
      expect(cookieSvc.setRefreshCookie).not.toHaveBeenCalled();
    });

    it('user login with TOTP code → forwards totpCode to auth-service', async () => {
      authSvc.loginUser.mockResolvedValue({
        user: { id: 1, email: 'x', name: 'x', scopes: [] },
        refreshToken: 'u:r',
      });
      const reply = makeReply();
      await controller.login(
        { email: 'a@b', password: 'pw', type: 'user', totpCode: '123456' } as any,
        {} as any,
        reply as any,
      );
      expect(authSvc.loginUser).toHaveBeenCalledWith('a@b', 'pw', '123456');
    });

    it('admin login success → issues cookies with adminId and empty scopes', async () => {
      authSvc.loginAdmin.mockResolvedValue({
        admin: { id: 11, email: 'ad@x', name: 'admin' },
        refreshToken: 'a:tok',
      });
      const reply = makeReply();
      const body = await controller.login(
        { email: 'ad@x', password: 'pw', type: 'admin' } as any,
        {} as any,
        reply as any,
      );
      expect(authSvc.loginAdmin).toHaveBeenCalledWith('ad@x', 'pw', undefined);
      expect(cookieSvc.setSessionCookie).toHaveBeenCalledWith(reply, {
        adminId: 11,
        email: 'ad@x',
        name: 'admin',
        type: 'admin',
        scopes: [],
      });
      expect(cookieSvc.setRefreshCookie).toHaveBeenCalledWith(reply, 'a:tok');
      expect(body).toEqual({ admin: { id: 11, email: 'ad@x', name: 'admin' } });
    });

    it('admin login requiring 2FA → returns {requires2fa:true} without setting cookies', async () => {
      authSvc.loginAdmin.mockResolvedValue({ requires2fa: true });
      const reply = makeReply();
      const body = await controller.login(
        { email: 'ad@x', password: 'pw', type: 'admin' } as any,
        {} as any,
        reply as any,
      );
      expect(body).toEqual({ requires2fa: true });
      expect(cookieSvc.setSessionCookie).not.toHaveBeenCalled();
    });

    it('admin login propagates bad-credentials RpcException', async () => {
      const rpc = new RpcException({ status: 401, message: 'bad creds' });
      authSvc.loginAdmin.mockRejectedValue(rpc);
      const reply = makeReply();
      await expect(
        controller.login(
          { email: 'ad@x', password: 'pw', type: 'admin' } as any,
          {} as any,
          reply as any,
        ),
      ).rejects.toBe(rpc);
      expect(cookieSvc.setSessionCookie).not.toHaveBeenCalled();
    });
  });

  describe('GET /auth/session', () => {
    it('returns session payload + CSRF token via reply.generateCsrf()', () => {
      const reply = makeReply();
      const req: any = {
        session: { userId: 7, email: 'a@b.com', name: 'alice', type: 'user', scopes: [] },
      };
      const body = controller.session(req, reply as any);
      expect(reply.generateCsrf).toHaveBeenCalled();
      expect(body).toEqual({
        userId: 7,
        email: 'a@b.com',
        name: 'alice',
        type: 'user',
        scopes: [],
        csrfToken: 'csrf-token-xyz',
      });
    });

    it('falls back to req.server.csrfProtection.generate when reply.generateCsrf is absent', () => {
      const generate = jest.fn().mockReturnValue('fallback-csrf');
      const reply: any = {
        setCookie: jest.fn(),
        clearCookie: jest.fn(),
        // generateCsrf intentionally omitted.
      };
      const req: any = {
        session: { userId: 3, email: 'u@x', name: 'u', type: 'user', scopes: [] },
        server: { csrfProtection: { generate } },
      };
      const body = controller.session(req, reply);
      expect(generate).toHaveBeenCalledWith(req, reply);
      expect(body.csrfToken).toBe('fallback-csrf');
    });

    it('emits undefined csrfToken when neither generator is wired up', () => {
      const reply: any = { setCookie: jest.fn(), clearCookie: jest.fn() };
      const req: any = {
        session: { userId: 3, email: 'u@x', name: 'u', type: 'user', scopes: [] },
      };
      const body = controller.session(req, reply);
      expect(body.csrfToken).toBeUndefined();
    });
  });

  describe('POST /auth/logout', () => {
    it('with user refresh cookie → calls logoutUser and clears cookies', async () => {
      cookieSvc.readRefreshCookie.mockReturnValue('u:rt');
      authSvc.logoutUser.mockResolvedValue(undefined);
      const reply = makeReply();
      await controller.logout({} as any, reply as any);
      expect(authSvc.logoutUser).toHaveBeenCalledWith('u:rt');
      expect(authSvc.logoutAdmin).not.toHaveBeenCalled();
      expect(cookieSvc.clearCookies).toHaveBeenCalledWith(reply);
    });

    it('with admin refresh cookie → calls logoutAdmin and clears cookies', async () => {
      cookieSvc.readRefreshCookie.mockReturnValue('a:tok');
      authSvc.logoutAdmin.mockResolvedValue(undefined);
      const reply = makeReply();
      await controller.logout({} as any, reply as any);
      expect(authSvc.logoutAdmin).toHaveBeenCalledWith('a:tok');
      expect(authSvc.logoutUser).not.toHaveBeenCalled();
      expect(cookieSvc.clearCookies).toHaveBeenCalledWith(reply);
    });

    it('without refresh cookie → still clears cookies and skips upstream', async () => {
      cookieSvc.readRefreshCookie.mockReturnValue(null);
      const reply = makeReply();
      await controller.logout({} as any, reply as any);
      expect(authSvc.logoutUser).not.toHaveBeenCalled();
      expect(authSvc.logoutAdmin).not.toHaveBeenCalled();
      expect(cookieSvc.clearCookies).toHaveBeenCalledWith(reply);
    });
  });
});
