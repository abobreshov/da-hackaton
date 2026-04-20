/**
 * HTTP UsersController — thin pass-through; guard is applied declaratively
 * and exercised in jwt.guard.spec.ts. These tests verify the controller
 * delegates correctly to the service.
 */

jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

import { UsersController } from './users.controller';
import type { UsersService } from './users.service';

describe('UsersController', () => {
  let service: jest.Mocked<UsersService>;
  let controller: UsersController;

  beforeEach(() => {
    service = {
      findAll: jest.fn(),
      findById: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;
    controller = new UsersController(service);
  });

  it('GET /users delegates to service.findAll()', async () => {
    service.findAll.mockResolvedValue([{ id: 1 } as any]);
    const out = await controller.findAll();
    expect(service.findAll).toHaveBeenCalledTimes(1);
    expect(out).toEqual([{ id: 1 }]);
  });

  it('GET /users/:id delegates to service.findById(id)', async () => {
    service.findById.mockResolvedValue({ id: 42 } as any);
    const out = await controller.findById(42);
    expect(service.findById).toHaveBeenCalledWith(42);
    expect(out).toEqual({ id: 42 });
  });

  it('propagates service errors (e.g., NotFound)', async () => {
    const err = new Error('nope');
    service.findById.mockRejectedValue(err);
    await expect(controller.findById(999)).rejects.toBe(err);
  });
});
