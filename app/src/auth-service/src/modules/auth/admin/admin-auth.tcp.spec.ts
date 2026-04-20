process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48);
process.env.JWT_CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);

/**
 * TCP-layer AdminAuthTcpController: @MessagePattern handlers dispatch straight
 * to the service. HttpException -> RpcException translation is handled by the
 * global `RpcExceptionFilter` (covered in its own spec under
 * `common/rpc/rpc-exception.filter.spec.ts`); here we just assert dispatch +
 * raw exception propagation.
 */

import { HttpException, HttpStatus } from '@nestjs/common';
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

  it('login propagates HttpException (filter maps to Rpc(401))', async () => {
    svc.login.mockRejectedValue(new HttpException('bad', HttpStatus.UNAUTHORIZED));
    await expect(
      ctrl.login({ email: 'admin@example.com', password: 'pw' } as any),
    ).rejects.toBeInstanceOf(HttpException);
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

  it('logout propagates Error (filter maps to Rpc(500))', async () => {
    svc.logout.mockRejectedValue(new Error('oops'));
    await expect(ctrl.logout({ refreshToken: 'a:1:abc' })).rejects.toBeInstanceOf(Error);
  });
});
