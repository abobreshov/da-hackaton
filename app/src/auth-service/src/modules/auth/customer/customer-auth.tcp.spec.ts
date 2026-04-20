process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48);
process.env.JWT_CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);

/**
 * TCP-layer CustomerAuthTcpController: @MessagePattern handlers dispatch
 * straight to the service. HttpException -> RpcException translation is
 * handled by the global `RpcExceptionFilter` (covered in its own spec under
 * `common/rpc/rpc-exception.filter.spec.ts`); here we just assert dispatch +
 * raw exception propagation.
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import { CustomerAuthTcpController } from './customer-auth.tcp';
import { CustomerAuthService } from './customer-auth.service';

function makeService(): jest.Mocked<CustomerAuthService> {
  return {
    login: jest.fn(),
    register: jest.fn(),
    verifyEmail: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    validateToken: jest.fn(),
    passwordResetRequest: jest.fn(),
    passwordResetConfirm: jest.fn(),
    passwordChange: jest.fn(),
    deleteAccount: jest.fn(),
  } as any;
}

describe('CustomerAuthTcpController', () => {
  let ctrl: CustomerAuthTcpController;
  let svc: jest.Mocked<CustomerAuthService>;

  beforeEach(() => {
    svc = makeService();
    ctrl = new CustomerAuthTcpController(svc);
  });

  describe('login', () => {
    it('passes through the service result', async () => {
      svc.login.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' } as any);
      await expect(ctrl.login({ email: 'u@x.com', password: 'pw' } as any)).resolves.toMatchObject({
        accessToken: 'a',
      });
    });

    it('propagates HttpException (filter maps to Rpc(401))', async () => {
      svc.login.mockRejectedValue(
        new HttpException({ code: 'UNAUTHENTICATED', message: 'bad' }, HttpStatus.UNAUTHORIZED),
      );
      await expect(ctrl.login({ email: 'u@x.com', password: 'pw' } as any)).rejects.toBeInstanceOf(
        HttpException,
      );
    });
  });

  describe('refresh', () => {
    it('extracts refreshToken and passes through the result', async () => {
      svc.refresh.mockResolvedValue({ accessToken: 'a' } as any);
      await ctrl.refresh({ refreshToken: 'u:1:abc' });
      expect(svc.refresh).toHaveBeenCalledWith('u:1:abc');
    });
  });

  describe('logout', () => {
    it('returns { ok: true } on success', async () => {
      svc.logout.mockResolvedValue(undefined);
      await expect(ctrl.logout({ refreshToken: 'u:1:abc' })).resolves.toEqual({ ok: true });
      expect(svc.logout).toHaveBeenCalledWith('u:1:abc');
    });
  });

  describe('validateToken', () => {
    it('extracts token from payload and delegates', async () => {
      svc.validateToken.mockResolvedValue({ userId: 1 } as any);
      await ctrl.validateToken({ token: 'tok' });
      expect(svc.validateToken).toHaveBeenCalledWith('tok');
    });
  });

  describe('register', () => {
    it('delegates the whole DTO and forwards the { ok: true } shape', async () => {
      svc.register.mockResolvedValue({ ok: true } as any);
      const dto = { email: 'u@x.com', username: 'u', password: 'Sup3rSecret' };
      await expect(ctrl.register(dto as any)).resolves.toEqual({ ok: true });
      expect(svc.register).toHaveBeenCalledWith(dto);
    });
  });

  describe('verifyEmail', () => {
    it('extracts token from payload, delegates, and forwards the session envelope', async () => {
      const envelope = { user: { id: 1 }, accessToken: 'at', refreshToken: 'u:1:r' };
      svc.verifyEmail.mockResolvedValue(envelope as any);
      await expect(ctrl.verifyEmail({ token: 'tok' })).resolves.toBe(envelope);
      expect(svc.verifyEmail).toHaveBeenCalledWith('tok');
    });
  });

  describe('passwordResetRequest', () => {
    it('returns { ok: true } on success', async () => {
      svc.passwordResetRequest.mockResolvedValue(undefined);
      await expect(ctrl.passwordResetRequest({ email: 'u@x.com' } as any)).resolves.toEqual({
        ok: true,
      });
    });
  });

  describe('passwordResetConfirm', () => {
    it('returns { ok: true } on success', async () => {
      svc.passwordResetConfirm.mockResolvedValue(undefined);
      await expect(
        ctrl.passwordResetConfirm({ token: 't', newPassword: 'p' } as any),
      ).resolves.toEqual({ ok: true });
    });
  });

  describe('passwordChange', () => {
    it('delegates with userId from payload and forwards the service response (user + tokens)', async () => {
      const response = {
        user: { id: 5, email: 'u@x', name: 'u', role: 'USER' as const, scopes: [] as string[] },
        accessToken: 'at',
        refreshToken: 'u:5:rt',
      };
      svc.passwordChange.mockResolvedValue(response as any);
      const payload = { currentPassword: 'old', newPassword: 'NewPass123', userId: 5 };
      await expect(ctrl.passwordChange(payload as any)).resolves.toBe(response);
      expect(svc.passwordChange).toHaveBeenCalledWith(payload);
    });
  });

  describe('deleteAccount', () => {
    it('delegates and returns { ok: true }', async () => {
      svc.deleteAccount.mockResolvedValue(undefined);
      await expect(ctrl.deleteAccount({ userId: 9 })).resolves.toEqual({ ok: true });
      expect(svc.deleteAccount).toHaveBeenCalledWith({ userId: 9 });
    });

    it('propagates unknown Error (filter maps to Rpc(500))', async () => {
      svc.deleteAccount.mockRejectedValue(new Error('boom'));
      await expect(ctrl.deleteAccount({ userId: 9 })).rejects.toBeInstanceOf(Error);
    });
  });
});
