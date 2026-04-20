process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48);
process.env.JWT_CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);

import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';

describe('AdminAuthController', () => {
  let controller: AdminAuthController;
  let service: jest.Mocked<AdminAuthService>;

  beforeEach(() => {
    service = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
    } as any;
    controller = new AdminAuthController(service);
  });

  it('login delegates to service', async () => {
    service.login.mockResolvedValue({ accessToken: 'a' } as any);
    const dto = { email: 'admin@example.com', password: 'Sup3rSecret' };
    await expect(controller.login(dto as any)).resolves.toEqual({ accessToken: 'a' });
    expect(service.login).toHaveBeenCalledWith(dto);
  });

  it('refresh extracts refreshToken and delegates', async () => {
    service.refresh.mockResolvedValue({ accessToken: 'a' } as any);
    await controller.refresh({ refreshToken: 'a:1:abc' } as any);
    expect(service.refresh).toHaveBeenCalledWith('a:1:abc');
  });

  it('logout delegates and resolves void', async () => {
    service.logout.mockResolvedValue(undefined);
    await expect(controller.logout({ refreshToken: 'a:1:abc' } as any)).resolves.toBeUndefined();
    expect(service.logout).toHaveBeenCalledWith('a:1:abc');
  });
});
