process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48);
process.env.JWT_CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);

import { HttpException, HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { AdminAuthTcpController } from './admin-auth.tcp';
import { AdminAuthService } from './admin-auth.service';

describe('AdminAuthTcpController', () => {
  let ctrl: AdminAuthTcpController;
  let svc: jest.Mocked<AdminAuthService>;

  beforeEach(() => {
    svc = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
    } as any;
    ctrl = new AdminAuthTcpController(svc);
  });

  it('login passes through', async () => {
    svc.login.mockResolvedValue({ accessToken: 'a' } as any);
    await ctrl.login({ email: 'admin@example.com', password: 'pw' } as any);
    expect(svc.login).toHaveBeenCalled();
  });

  it('login maps HttpException -> RpcException', async () => {
    svc.login.mockRejectedValue(new HttpException('bad', HttpStatus.UNAUTHORIZED));
    const promise = ctrl.login({ email: 'admin@example.com', password: 'pw' } as any);
    await expect(promise).rejects.toBeInstanceOf(RpcException);
    await promise.catch((e: RpcException) => {
      expect(e.getError()).toMatchObject({ status: 401, message: 'bad' });
    });
  });

  it('refresh extracts refreshToken from payload', async () => {
    svc.refresh.mockResolvedValue({ accessToken: 'a' } as any);
    await ctrl.refresh({ refreshToken: 'a:1:abc' });
    expect(svc.refresh).toHaveBeenCalledWith('a:1:abc');
  });

  it('logout returns { ok: true }', async () => {
    svc.logout.mockResolvedValue(undefined);
    await expect(ctrl.logout({ refreshToken: 'a:1:abc' })).resolves.toEqual({ ok: true });
  });

  it('logout maps Error -> RpcException(500)', async () => {
    svc.logout.mockRejectedValue(new Error('oops'));
    const promise = ctrl.logout({ refreshToken: 'a:1:abc' });
    await expect(promise).rejects.toBeInstanceOf(RpcException);
    await promise.catch((e: RpcException) => {
      expect(e.getError()).toMatchObject({ status: 500, message: 'oops' });
    });
  });
});
