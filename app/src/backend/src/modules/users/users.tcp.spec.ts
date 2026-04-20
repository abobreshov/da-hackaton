/**
 * TCP-layer UsersTcpController — @MessagePattern handlers that dispatch to
 * the service. No error envelope wrapping here (unlike rooms.tcp) so we
 * only verify forwarding.
 */

jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

import { UsersTcpController } from './users.tcp';
import type { UsersService } from './users.service';

describe('UsersTcpController', () => {
  let service: jest.Mocked<UsersService>;
  let controller: UsersTcpController;

  beforeEach(() => {
    service = {
      findAll: jest.fn(),
      findById: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;
    controller = new UsersTcpController(service);
  });

  it('users.list -> service.findAll()', async () => {
    service.findAll.mockResolvedValue([{ id: 1 } as any, { id: 2 } as any]);
    const out = await controller.list();
    expect(service.findAll).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(2);
  });

  it('users.findById -> service.findById(data.id)', async () => {
    service.findById.mockResolvedValue({ id: 7 } as any);
    const out = await controller.findById({ id: 7 });
    expect(service.findById).toHaveBeenCalledWith(7);
    expect(out).toEqual({ id: 7 });
  });
});
