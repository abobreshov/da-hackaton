// Stub env so transitive imports (microservice.module → environment) don't
// require real secrets at test time. Mirrors auth.controller.spec pattern.
jest.mock('../../config/environment', () => ({
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

import { of, throwError } from 'rxjs';
import { RpcException } from '@nestjs/microservices';
import { RoomsService } from './rooms.service';

function makeClient() {
  return {
    send: jest.fn(),
  };
}

describe('RoomsService (BFF)', () => {
  let client: ReturnType<typeof makeClient>;
  let service: RoomsService;

  beforeEach(() => {
    client = makeClient();
    service = new RoomsService(client as any);
  });

  describe('catalog()', () => {
    it('sends rooms.catalog with _sys envelope and returns upstream list', async () => {
      const list = [{ id: 1, name: 'general', visibility: 'public' }];
      client.send.mockReturnValueOnce(of(list));

      const result = await service.catalog();

      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'rooms.catalog' },
        expect.objectContaining({ _sys: 'test-sys-key' }),
      );
      expect(result).toEqual(list);
    });

    it('propagates RpcException from upstream', async () => {
      const rpc = new RpcException({ status: 502, message: 'upstream down' });
      client.send.mockReturnValueOnce(throwError(() => rpc));
      await expect(service.catalog()).rejects.toBe(rpc);
    });
  });

  describe('listMy(userId)', () => {
    it('sends rooms.listMy with userId payload', async () => {
      const rooms = [{ id: 3, name: 'mine' }];
      client.send.mockReturnValueOnce(of(rooms));

      const result = await service.listMy(42);

      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'rooms.listMy' },
        expect.objectContaining({ _sys: 'test-sys-key', userId: 42 }),
      );
      expect(result).toEqual(rooms);
    });
  });

  describe('create(input)', () => {
    it('sends rooms.create with full payload', async () => {
      const created = { id: 7, name: 'hackers', visibility: 'public' };
      client.send.mockReturnValueOnce(of(created));

      const result = await service.create({
        ownerId: 11,
        name: 'hackers',
        visibility: 'public',
        description: 'a room',
      });

      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'rooms.create' },
        expect.objectContaining({
          _sys: 'test-sys-key',
          ownerId: 11,
          name: 'hackers',
          visibility: 'public',
          description: 'a room',
        }),
      );
      expect(result).toEqual(created);
    });

    it('omits description when not supplied (still sends an object)', async () => {
      client.send.mockReturnValueOnce(of({ id: 8 }));
      await service.create({ ownerId: 1, name: 'x', visibility: 'private' });
      const [, payload] = client.send.mock.calls[0];
      expect(payload).toMatchObject({ ownerId: 1, name: 'x', visibility: 'private' });
    });

    it('propagates CONFLICT RpcException', async () => {
      const rpc = new RpcException({ status: 409, message: 'name taken' });
      client.send.mockReturnValueOnce(throwError(() => rpc));
      await expect(
        service.create({ ownerId: 1, name: 'dup', visibility: 'public' }),
      ).rejects.toBe(rpc);
    });
  });

  describe('join({userId,roomId})', () => {
    it('sends rooms.join with payload', async () => {
      client.send.mockReturnValueOnce(of({ ok: true }));

      await service.join({ userId: 42, roomId: 5 });

      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'rooms.join' },
        expect.objectContaining({ _sys: 'test-sys-key', userId: 42, roomId: 5 }),
      );
    });

    it('propagates FORBIDDEN (banned)', async () => {
      const rpc = new RpcException({ status: 403, message: 'banned' });
      client.send.mockReturnValueOnce(throwError(() => rpc));
      await expect(service.join({ userId: 1, roomId: 2 })).rejects.toBe(rpc);
    });
  });

  describe('leave({userId,roomId})', () => {
    it('sends rooms.leave with payload', async () => {
      client.send.mockReturnValueOnce(of({ ok: true }));

      const result = await service.leave({ userId: 42, roomId: 5 });

      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'rooms.leave' },
        expect.objectContaining({ _sys: 'test-sys-key', userId: 42, roomId: 5 }),
      );
      expect(result).toEqual({ ok: true });
    });

    it('propagates NOT_FOUND', async () => {
      const rpc = new RpcException({ status: 404, message: 'no such room' });
      client.send.mockReturnValueOnce(throwError(() => rpc));
      await expect(service.leave({ userId: 1, roomId: 2 })).rejects.toBe(rpc);
    });
  });

  describe('invite({inviterId,inviteeId,roomId})', () => {
    it('sends rooms.invite with payload', async () => {
      client.send.mockReturnValueOnce(of({ id: 99, status: 'pending' }));

      const result = await service.invite({ inviterId: 3, inviteeId: 4, roomId: 5 });

      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'rooms.invite' },
        expect.objectContaining({
          _sys: 'test-sys-key',
          inviterId: 3,
          inviteeId: 4,
          roomId: 5,
        }),
      );
      expect(result).toEqual({ id: 99, status: 'pending' });
    });

    it('propagates CONFLICT (duplicate invite)', async () => {
      const rpc = new RpcException({ status: 409, message: 'already invited' });
      client.send.mockReturnValueOnce(throwError(() => rpc));
      await expect(
        service.invite({ inviterId: 1, inviteeId: 2, roomId: 3 }),
      ).rejects.toBe(rpc);
    });
  });
});
