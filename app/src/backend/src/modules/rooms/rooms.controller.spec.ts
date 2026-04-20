/**
 * Controller-level tests: verify RoomsController routes to the service with
 * the caller's user id extracted from the request, and propagates errors
 * thrown by the service (no swallowing).
 *
 * Env is stubbed before import because the controller pulls in JwtGuard
 * which transitively reaches `config/environment` (zod-validated) — in a
 * bare unit test we don't want to require DATABASE_URL to be set.
 */

jest.mock('../../config/environment', () => ({
  env: {
    SYSTEM_KEY: 'test-system-key-32-char-value-abcde',
    TLS_ENABLED: false,
    AUTH_TCP_HOST: 'localhost',
    AUTH_TCP_PORT: 4003,
  },
}));

import { UnauthorizedException } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

function makeService(): jest.Mocked<RoomsService> {
  return {
    create: jest.fn(),
    catalog: jest.fn(),
    listMy: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    invite: jest.fn(),
  } as unknown as jest.Mocked<RoomsService>;
}

function req(userId: number | undefined, shape: 'id' | 'sub' = 'id'): any {
  if (userId === undefined) return { user: undefined };
  return { user: { [shape]: userId } };
}

describe('RoomsController', () => {
  let service: jest.Mocked<RoomsService>;
  let controller: RoomsController;

  beforeEach(() => {
    service = makeService();
    controller = new RoomsController(service);
  });

  describe('create', () => {
    it('forwards body + caller id to service.create', async () => {
      service.create.mockResolvedValue({ id: 10 } as any);
      const out = await controller.create(
        { name: 'dev', visibility: 'public', description: 'chat' } as any,
        req(7),
      );
      expect(service.create).toHaveBeenCalledWith({
        ownerId: 7,
        name: 'dev',
        visibility: 'public',
        description: 'chat',
      });
      expect(out).toEqual({ id: 10 });
    });

    it('falls back to user.sub when user.id is missing', async () => {
      service.create.mockResolvedValue({ id: 1 } as any);
      await controller.create({ name: 'x', visibility: 'public' } as any, req(42, 'sub'));
      expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 42 }));
    });

    it('throws UnauthorizedException when user is missing', () => {
      expect(() =>
        controller.create({ name: 'x', visibility: 'public' } as any, { user: undefined }),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('catalog & listMy', () => {
    it('catalog delegates with no args', async () => {
      service.catalog.mockResolvedValue([{ id: 1 }] as any);
      await expect(controller.catalog()).resolves.toEqual([{ id: 1 }]);
    });

    it('listMy passes caller id', async () => {
      service.listMy.mockResolvedValue([] as any);
      await controller.listMy(req(9));
      expect(service.listMy).toHaveBeenCalledWith(9);
    });
  });

  describe('join / leave', () => {
    it('join passes roomId + caller id', async () => {
      service.join.mockResolvedValue({} as any);
      await controller.join(3, req(5));
      expect(service.join).toHaveBeenCalledWith({ userId: 5, roomId: 3 });
    });

    it('leave passes roomId + caller id', async () => {
      service.leave.mockResolvedValue(undefined);
      await controller.leave(3, req(5));
      expect(service.leave).toHaveBeenCalledWith({ userId: 5, roomId: 3 });
    });

    it('propagates service errors unchanged', async () => {
      service.leave.mockRejectedValue(new Error('boom'));
      await expect(controller.leave(3, req(5))).rejects.toThrow('boom');
    });
  });

  describe('invite', () => {
    it('forwards inviteeId + inviter id + roomId', async () => {
      service.invite.mockResolvedValue({ id: 99 } as any);
      const out = await controller.invite(11, { invitedUserId: 22 } as any, req(1));
      expect(service.invite).toHaveBeenCalledWith({
        inviterId: 1,
        inviteeId: 22,
        roomId: 11,
      });
      expect(out).toEqual({ id: 99 });
    });
  });
});
