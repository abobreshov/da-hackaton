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

import { RpcException } from '@nestjs/microservices';
import { RoomsService } from './rooms.service';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

function makeClient() {
  return { send: jest.fn() };
}

function makeProxy() {
  return { forward: jest.fn() } as unknown as jest.Mocked<RpcProxyService>;
}

function makeUsers() {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    resolveUserIdByUsername: jest.fn(),
  };
}

describe('RoomsService (BFF)', () => {
  let client: ReturnType<typeof makeClient>;
  let proxy: jest.Mocked<RpcProxyService>;
  let users: ReturnType<typeof makeUsers>;
  let service: RoomsService;

  beforeEach(() => {
    client = makeClient();
    proxy = makeProxy();
    users = makeUsers();
    service = new RoomsService(client as any, proxy as any, users as any);
  });

  describe('catalog()', () => {
    it('forwards rooms.catalog via RpcProxy', async () => {
      const list = [{ id: 1, name: 'general', visibility: 'public' }];
      (proxy.forward as jest.Mock).mockResolvedValueOnce(list);

      const result = await service.catalog();

      expect(proxy.forward).toHaveBeenCalledWith(client, { cmd: 'rooms.catalog' }, {});
      expect(result).toEqual(list);
    });

    it('propagates RpcException from upstream', async () => {
      const rpc = new RpcException({ status: 502, message: 'upstream down' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.catalog()).rejects.toBe(rpc);
    });
  });

  describe('listMy(userId)', () => {
    it('forwards rooms.listMy with userId payload', async () => {
      const rooms = [{ id: 3, name: 'mine' }];
      (proxy.forward as jest.Mock).mockResolvedValueOnce(rooms);

      const result = await service.listMy(42);

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'rooms.listMy' },
        { userId: 42 },
      );
      expect(result).toEqual(rooms);
    });
  });

  describe('create(input)', () => {
    it('forwards rooms.create with full payload', async () => {
      const created = { id: 7, name: 'hackers', visibility: 'public' };
      (proxy.forward as jest.Mock).mockResolvedValueOnce(created);

      const result = await service.create({
        ownerId: 11,
        name: 'hackers',
        visibility: 'public',
        description: 'a room',
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'rooms.create' },
        {
          ownerId: 11,
          name: 'hackers',
          visibility: 'public',
          description: 'a room',
        },
      );
      expect(result).toEqual(created);
    });

    it('omits description when not supplied (still passes object)', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ id: 8 });
      await service.create({ ownerId: 1, name: 'x', visibility: 'private' });
      const [, , payload] = (proxy.forward as jest.Mock).mock.calls[0];
      expect(payload).toEqual({ ownerId: 1, name: 'x', visibility: 'private' });
    });

    it('propagates CONFLICT RpcException', async () => {
      const rpc = new RpcException({ status: 409, message: 'name taken' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(
        service.create({ ownerId: 1, name: 'dup', visibility: 'public' }),
      ).rejects.toBe(rpc);
    });
  });

  describe('join({userId,roomId})', () => {
    it('forwards rooms.join with payload', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ ok: true });

      await service.join({ userId: 42, roomId: 5 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'rooms.join' },
        { userId: 42, roomId: 5 },
      );
    });

    it('propagates FORBIDDEN (banned)', async () => {
      const rpc = new RpcException({ status: 403, message: 'banned' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.join({ userId: 1, roomId: 2 })).rejects.toBe(rpc);
    });
  });

  describe('leave({userId,roomId})', () => {
    it('forwards rooms.leave with payload', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ ok: true });

      const result = await service.leave({ userId: 42, roomId: 5 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'rooms.leave' },
        { userId: 42, roomId: 5 },
      );
      expect(result).toEqual({ ok: true });
    });

    it('propagates NOT_FOUND', async () => {
      const rpc = new RpcException({ status: 404, message: 'no such room' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.leave({ userId: 1, roomId: 2 })).rejects.toBe(rpc);
    });
  });

  describe('invite({inviterId,inviteeId|username,roomId})', () => {
    it('forwards rooms.invite when inviteeId is pre-supplied (no resolver call)', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ id: 99, status: 'pending' });

      const result = await service.invite({ inviterId: 3, inviteeId: 4, roomId: 5 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'rooms.invite' },
        { inviterId: 3, inviteeId: 4, roomId: 5 },
      );
      expect(users.resolveUserIdByUsername).not.toHaveBeenCalled();
      expect(result).toEqual({ queued: false, invited: { id: 99, status: 'pending' } });
    });

    it('resolves {username} → inviteeId via UsersService before forwarding', async () => {
      users.resolveUserIdByUsername.mockResolvedValueOnce({ userId: 42, found: true });
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ id: 7, status: 'pending' });

      const result = await service.invite({
        inviterId: 3,
        username: 'alice',
        roomId: 5,
      });

      expect(users.resolveUserIdByUsername).toHaveBeenCalledWith('alice');
      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'rooms.invite' },
        { inviterId: 3, inviteeId: 42, roomId: 5 },
      );
      expect(result).toEqual({ queued: false, invited: { id: 7, status: 'pending' } });
    });

    it('returns {queued:true, invited:null} on unknown username — fail-silent (ADR-005)', async () => {
      users.resolveUserIdByUsername.mockResolvedValueOnce({ userId: null, found: false });

      const result = await service.invite({ inviterId: 3, username: 'ghost', roomId: 5 });

      expect(result).toEqual({ queued: true, invited: null });
      // Backend RPC must NOT be called when the username does not resolve.
      expect(proxy.forward).not.toHaveBeenCalled();
    });

    it('propagates CONFLICT (duplicate invite) when backend rejects', async () => {
      const rpc = new RpcException({ status: 409, message: 'already invited' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(
        service.invite({ inviterId: 1, inviteeId: 2, roomId: 3 }),
      ).rejects.toBe(rpc);
    });
  });

  describe('update({roomId, actorId, patch})', () => {
    it('forwards rooms.update with full patch', async () => {
      const updated = { id: 5, name: 'renamed', description: 'new', visibility: 'private' };
      (proxy.forward as jest.Mock).mockResolvedValueOnce(updated);

      const result = await service.update({
        roomId: 5,
        actorId: 3,
        patch: { name: 'renamed', description: 'new', visibility: 'private' },
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'rooms.update' },
        {
          roomId: 5,
          actorId: 3,
          patch: { name: 'renamed', description: 'new', visibility: 'private' },
        },
      );
      expect(result).toEqual(updated);
    });

    it('forwards rooms.update with partial patch (name only)', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ id: 5, name: 'x' });

      await service.update({ roomId: 5, actorId: 3, patch: { name: 'x' } });

      const [, , payload] = (proxy.forward as jest.Mock).mock.calls[0];
      expect(payload).toMatchObject({
        roomId: 5,
        actorId: 3,
        patch: { name: 'x' },
      });
    });

    it('propagates FORBIDDEN (not the owner)', async () => {
      const rpc = new RpcException({ status: 403, message: 'not the owner' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(
        service.update({ roomId: 5, actorId: 9, patch: { name: 'x' } }),
      ).rejects.toBe(rpc);
    });

    it('propagates CONFLICT (name taken)', async () => {
      const rpc = new RpcException({ status: 409, message: 'name taken' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(
        service.update({ roomId: 5, actorId: 3, patch: { name: 'dup' } }),
      ).rejects.toBe(rpc);
    });
  });
});
