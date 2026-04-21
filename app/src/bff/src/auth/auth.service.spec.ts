import { EMPTY, NEVER, of, throwError } from 'rxjs';
import { RpcException } from '@nestjs/microservices';
import { HttpException } from '@nestjs/common';
import { ErrorCode } from '@app/contracts';
import { AuthService } from './auth.service';

// Mock env so withSys stamps a deterministic key.
jest.mock('../config/environment', () => ({
  env: { SYSTEM_KEY: 'test-sys-key', TLS_ENABLED: false },
}));

function makeClient() {
  return {
    send: jest.fn(),
  } as any;
}

describe('AuthService — new proxy methods', () => {
  let svc: AuthService;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    client = makeClient();
    svc = new AuthService(client);
  });

  describe('register', () => {
    it('sends auth.customer.register with withSys-wrapped {email,username,password} and resolves to { ok: true }', async () => {
      const expected = { ok: true };
      client.send.mockReturnValue(of(expected));
      await expect(svc.register('a@b.com', 'alice', 'pw12345678')).resolves.toEqual(expected);
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'auth.customer.register' },
        { email: 'a@b.com', username: 'alice', password: 'pw12345678', _sys: 'test-sys-key' },
      );
    });

    it('propagates RpcException from upstream (e.g. rate-limit / infra failure)', async () => {
      const rpc = new RpcException({ status: 429, message: 'rate limit exceeded' });
      client.send.mockReturnValue(throwError(() => rpc));
      await expect(svc.register('a@b.com', 'alice', 'pw12345678')).rejects.toBe(rpc);
    });
  });

  describe('verifyEmail', () => {
    it('sends auth.customer.verifyEmail with withSys-wrapped {token}', async () => {
      const expected = { user: { id: 1 }, accessToken: 'at', refreshToken: 'u:1:r' };
      client.send.mockReturnValue(of(expected));
      await expect(svc.verifyEmail('tok')).resolves.toEqual(expected);
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'auth.customer.verifyEmail' },
        { token: 'tok', _sys: 'test-sys-key' },
      );
    });

    it('propagates RpcException NOT_FOUND for invalid or expired tokens', async () => {
      const rpc = new RpcException({
        status: 404,
        message: 'Verification token invalid or expired',
      });
      client.send.mockReturnValue(throwError(() => rpc));
      await expect(svc.verifyEmail('bad')).rejects.toBe(rpc);
    });
  });

  describe('passwordResetRequest', () => {
    it('sends auth.customer.passwordReset.request with {email}', async () => {
      client.send.mockReturnValue(of(undefined));
      await svc.passwordResetRequest('a@b.com');
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'auth.customer.passwordReset.request' },
        { email: 'a@b.com', _sys: 'test-sys-key' },
      );
    });
  });

  describe('passwordResetConfirm', () => {
    it('sends auth.customer.passwordReset.confirm with {token,newPassword}', async () => {
      client.send.mockReturnValue(of(undefined));
      await svc.passwordResetConfirm('tok', 'np12345678');
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'auth.customer.passwordReset.confirm' },
        { token: 'tok', newPassword: 'np12345678', _sys: 'test-sys-key' },
      );
    });
  });

  describe('passwordChange', () => {
    it('sends auth.customer.passwordChange with {userId,currentPassword,newPassword}', async () => {
      client.send.mockReturnValue(of(undefined));
      await svc.passwordChange(7, 'old12345', 'new12345');
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'auth.customer.passwordChange' },
        {
          userId: 7,
          currentPassword: 'old12345',
          newPassword: 'new12345',
          _sys: 'test-sys-key',
        },
      );
    });
  });

  describe('deleteAccount', () => {
    it('sends auth.customer.delete with {userId}', async () => {
      client.send.mockReturnValue(of(undefined));
      await svc.deleteAccount(42);
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'auth.customer.delete' },
        { userId: 42, _sys: 'test-sys-key' },
      );
    });
  });

  describe('login proxies', () => {
    it('loginUser → auth.customer.login with {email,password,totpCode,userAgent,ip}', async () => {
      const expected = { user: { id: 1 }, refreshToken: 'r' };
      client.send.mockReturnValue(of(expected));
      await expect(
        svc.loginUser('a@b', 'pw', '123456', 'Mozilla/5.0', '1.2.3.4'),
      ).resolves.toEqual(expected);
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'auth.customer.login' },
        {
          email: 'a@b',
          password: 'pw',
          totpCode: '123456',
          userAgent: 'Mozilla/5.0',
          ip: '1.2.3.4',
          _sys: 'test-sys-key',
        },
      );
    });

    it('loginUser without totpCode omits it only as undefined in payload', async () => {
      client.send.mockReturnValue(of({ requires2fa: true }));
      await svc.loginUser('a@b', 'pw');
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'auth.customer.login' },
        {
          email: 'a@b',
          password: 'pw',
          totpCode: undefined,
          userAgent: undefined,
          ip: undefined,
          _sys: 'test-sys-key',
        },
      );
    });

    it('loginAdmin → auth.admin.login forwards userAgent+ip', async () => {
      client.send.mockReturnValue(of({ admin: { id: 1 }, refreshToken: 'a:r' }));
      await svc.loginAdmin('ad@x', 'pw', undefined, 'curl/8', '10.0.0.1');
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'auth.admin.login' },
        {
          email: 'ad@x',
          password: 'pw',
          totpCode: undefined,
          userAgent: 'curl/8',
          ip: '10.0.0.1',
          _sys: 'test-sys-key',
        },
      );
    });

    it('loginAdmin propagates RpcException from upstream', async () => {
      const rpc = new RpcException({ status: 401, message: 'bad creds' });
      client.send.mockReturnValue(throwError(() => rpc));
      await expect(svc.loginAdmin('ad@x', 'pw')).rejects.toBe(rpc);
    });
  });

  describe('refresh proxies', () => {
    it('refreshUser → auth.customer.refresh', async () => {
      client.send.mockReturnValue(of({ user: { id: 1 }, refreshToken: 'u:new' }));
      await svc.refreshUser('u:old');
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'auth.customer.refresh' },
        { refreshToken: 'u:old', _sys: 'test-sys-key' },
      );
    });

    it('refreshUser propagates RpcException on expired token', async () => {
      const rpc = new RpcException({ status: 401, message: 'expired' });
      client.send.mockReturnValue(throwError(() => rpc));
      await expect(svc.refreshUser('u:old')).rejects.toBe(rpc);
    });

    it('refreshAdmin → auth.admin.refresh', async () => {
      client.send.mockReturnValue(of({ admin: { id: 1 }, refreshToken: 'a:new' }));
      await svc.refreshAdmin('a:old');
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'auth.admin.refresh' },
        { refreshToken: 'a:old', _sys: 'test-sys-key' },
      );
    });
  });

  describe('logout proxies', () => {
    it('logoutUser → auth.customer.logout', async () => {
      client.send.mockReturnValue(of(undefined));
      await svc.logoutUser('u:rt');
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'auth.customer.logout' },
        { refreshToken: 'u:rt', _sys: 'test-sys-key' },
      );
    });

    it('logoutAdmin → auth.admin.logout', async () => {
      client.send.mockReturnValue(of(undefined));
      await svc.logoutAdmin('a:rt');
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'auth.admin.logout' },
        { refreshToken: 'a:rt', _sys: 'test-sys-key' },
      );
    });

    it('logoutUser swallows upstream RPC failure only if caller does; by default propagates', async () => {
      const rpc = new RpcException({ status: 500, message: 'redis down' });
      client.send.mockReturnValue(throwError(() => rpc));
      await expect(svc.logoutUser('u:rt')).rejects.toBe(rpc);
    });
  });

  describe('upstream unavailability — EmptyError + TimeoutError', () => {
    function expectUpstream503(err: unknown) {
      expect(err).toBeInstanceOf(HttpException);
      const httpErr = err as HttpException;
      expect(httpErr.getStatus()).toBe(503);
      const body = httpErr.getResponse() as { code: string; message: string };
      expect(body.code).toBe(ErrorCode.UPSTREAM_UNAVAILABLE);
      expect(body.message).toMatch(/unavailable/i);
    }

    it('loginUser: completes-empty observable (auth-service rebuild kills socket) → HttpException 503 UPSTREAM_UNAVAILABLE', async () => {
      // EMPTY completes without emitting → firstValueFrom rejects with EmptyError.
      client.send.mockReturnValue(EMPTY);
      const err = await svc.loginUser('a@b', 'pw').catch((e: unknown) => e);
      expectUpstream503(err);
    });

    it('loginAdmin: completes-empty observable → 503 UPSTREAM_UNAVAILABLE', async () => {
      client.send.mockReturnValue(EMPTY);
      const err = await svc.loginAdmin('ad@x', 'pw').catch((e: unknown) => e);
      expectUpstream503(err);
    });

    it('refreshUser: hung TCP (no emission) → 503 after 5s timeout', async () => {
      jest.useFakeTimers();
      try {
        client.send.mockReturnValue(NEVER);
        const promise = svc.refreshUser('rt');
        const caught = promise.catch((e: unknown) => e);
        await jest.advanceTimersByTimeAsync(5000);
        const err = await caught;
        expectUpstream503(err);
      } finally {
        jest.useRealTimers();
      }
    });

    it('register: completes-empty → 503', async () => {
      client.send.mockReturnValue(EMPTY);
      const err = await svc
        .register('a@b.com', 'alice', 'pw12345678')
        .catch((e: unknown) => e);
      expectUpstream503(err);
    });

    it('validateUserToken: hung TCP → 503 after timeout', async () => {
      jest.useFakeTimers();
      try {
        client.send.mockReturnValue(NEVER);
        const promise = svc.validateUserToken('tok');
        const caught = promise.catch((e: unknown) => e);
        await jest.advanceTimersByTimeAsync(5000);
        const err = await caught;
        expectUpstream503(err);
      } finally {
        jest.useRealTimers();
      }
    });

    it('logoutUser: completes-empty → 503 (auth-service mid-restart on logout)', async () => {
      client.send.mockReturnValue(EMPTY);
      const err = await svc.logoutUser('rt').catch((e: unknown) => e);
      expectUpstream503(err);
    });

    it('does NOT mask upstream RpcException as 503 — real auth errors still bubble', async () => {
      const rpc = new RpcException({ status: 401, message: 'bad creds' });
      client.send.mockReturnValue(throwError(() => rpc));
      await expect(svc.loginUser('a@b', 'pw')).rejects.toBe(rpc);
    });
  });

  describe('validateUserToken', () => {
    it('sends auth.customer.validateToken with {token}', async () => {
      client.send.mockReturnValue(of({ userId: 7 }));
      await expect(svc.validateUserToken('bearer-tok')).resolves.toEqual({ userId: 7 });
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'auth.customer.validateToken' },
        { token: 'bearer-tok', _sys: 'test-sys-key' },
      );
    });

    it('propagates RpcException for invalid token', async () => {
      const rpc = new RpcException({ status: 401, message: 'invalid token' });
      client.send.mockReturnValue(throwError(() => rpc));
      await expect(svc.validateUserToken('bad')).rejects.toBe(rpc);
    });
  });
});
