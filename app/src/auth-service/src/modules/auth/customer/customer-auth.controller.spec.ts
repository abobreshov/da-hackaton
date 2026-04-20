process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48);
process.env.JWT_CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);

import { CustomerAuthController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';

function makeService(): jest.Mocked<CustomerAuthService> {
  return {
    login: jest.fn(),
    register: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    validateToken: jest.fn(),
    passwordResetRequest: jest.fn(),
    passwordResetConfirm: jest.fn(),
    passwordChange: jest.fn(),
    deleteAccount: jest.fn(),
  } as any;
}

describe('CustomerAuthController', () => {
  let controller: CustomerAuthController;
  let service: jest.Mocked<CustomerAuthService>;

  beforeEach(() => {
    service = makeService();
    controller = new CustomerAuthController(service);
  });

  describe('login', () => {
    it('delegates to service.login with the DTO and returns the value', async () => {
      service.login.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' } as any);
      const dto = { email: 'u@x.com', password: 'Sup3rSecret' };
      await expect(controller.login(dto as any)).resolves.toEqual({
        accessToken: 'a',
        refreshToken: 'r',
      });
      expect(service.login).toHaveBeenCalledWith(dto);
    });

    it('passes through a requires2fa response', async () => {
      service.login.mockResolvedValue({ requires2fa: true } as any);
      await expect(controller.login({ email: 'u@x.com', password: 'pw' } as any)).resolves.toEqual({
        requires2fa: true,
      });
    });
  });

  describe('register', () => {
    it('delegates to service.register', async () => {
      service.register.mockResolvedValue({ accessToken: 'a' } as any);
      const dto = { email: 'u@x.com', username: 'u', password: 'Sup3rSecret' };
      await expect(controller.register(dto as any)).resolves.toEqual({ accessToken: 'a' });
      expect(service.register).toHaveBeenCalledWith(dto);
    });
  });

  describe('refresh', () => {
    it('extracts refreshToken from DTO and delegates', async () => {
      service.refresh.mockResolvedValue({ accessToken: 'a' } as any);
      await expect(controller.refresh({ refreshToken: 'u:1:abc' } as any)).resolves.toEqual({
        accessToken: 'a',
      });
      expect(service.refresh).toHaveBeenCalledWith('u:1:abc');
    });
  });

  describe('logout', () => {
    it('delegates and resolves void (HTTP 204 handled by decorator)', async () => {
      service.logout.mockResolvedValue(undefined);
      await expect(controller.logout({ refreshToken: 'u:1:abc' } as any)).resolves.toBeUndefined();
      expect(service.logout).toHaveBeenCalledWith('u:1:abc');
    });
  });

  describe('validateToken', () => {
    it('strips the Bearer prefix before delegating', async () => {
      service.validateToken.mockResolvedValue({ userId: 1 } as any);
      await controller.validateToken('Bearer abc.def.ghi');
      expect(service.validateToken).toHaveBeenCalledWith('abc.def.ghi');
    });

    it('tolerates an undefined authorization header', async () => {
      service.validateToken.mockResolvedValue({ userId: 1 } as any);
      await controller.validateToken(undefined as unknown as string);
      expect(service.validateToken).toHaveBeenCalledWith(undefined);
    });
  });

  describe('passwordResetRequest', () => {
    it('delegates and resolves void', async () => {
      service.passwordResetRequest.mockResolvedValue(undefined);
      await expect(
        controller.passwordResetRequest({ email: 'u@x.com' } as any),
      ).resolves.toBeUndefined();
      expect(service.passwordResetRequest).toHaveBeenCalledWith({ email: 'u@x.com' });
    });
  });

  describe('passwordResetConfirm', () => {
    it('delegates and resolves void', async () => {
      service.passwordResetConfirm.mockResolvedValue(undefined);
      const dto = { token: 'x'.repeat(32), newPassword: 'NewPass123' };
      await expect(controller.passwordResetConfirm(dto as any)).resolves.toBeUndefined();
      expect(service.passwordResetConfirm).toHaveBeenCalledWith(dto);
    });
  });

  describe('passwordChange', () => {
    it('injects userId from req.user and delegates', async () => {
      // HTTP controller is 204-typed — BFF consumes the richer shape over TCP,
      // so we don't surface tokens on the direct-HTTP route. Mock the fat
      // response shape anyway so types line up with the service signature.
      service.passwordChange.mockResolvedValue({
        user: { id: 7, email: 'u@x.com', name: 'u', role: 'USER', scopes: [] },
        accessToken: 'at',
        refreshToken: 'u:7:rt',
      } as any);
      const dto = { currentPassword: 'old', newPassword: 'NewPass123' };
      const req = { user: { sub: 'u:7', type: 'user', email: 'u@x.com', scopes: [] } };
      await controller.passwordChange(dto as any, req as any);
      expect(service.passwordChange).toHaveBeenCalledWith({ ...dto, userId: 7 });
    });

    it('throws when req.user is missing (guard misconfiguration)', async () => {
      const dto = { currentPassword: 'old', newPassword: 'NewPass123' };
      await expect(controller.passwordChange(dto as any, {} as any)).rejects.toThrow(
        /missing user context/,
      );
      expect(service.passwordChange).not.toHaveBeenCalled();
    });
  });

  describe('deleteAccount', () => {
    it('injects userId from req.user and delegates', async () => {
      service.deleteAccount.mockResolvedValue(undefined);
      const req = { user: { sub: 'u:12', type: 'user', email: 'u@x.com', scopes: [] } };
      await controller.deleteAccount(req as any);
      expect(service.deleteAccount).toHaveBeenCalledWith({ userId: 12 });
    });

    it('throws when req.user is missing', async () => {
      await expect(controller.deleteAccount({} as any)).rejects.toThrow(/missing user context/);
      expect(service.deleteAccount).not.toHaveBeenCalled();
    });
  });
});
