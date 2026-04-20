jest.mock('../../config/environment', () => ({
  env: {
    SYSTEM_KEY: 'test-sys-key',
    TLS_ENABLED: false,
    BACKEND_TCP_HOST: '127.0.0.1',
    BACKEND_TCP_PORT: 4004,
    AUTH_TCP_HOST: '127.0.0.1',
    AUTH_TCP_PORT: 4003,
    NODE_ENV: 'test',
  },
}));

import { RpcException } from '@nestjs/microservices';
import { ModerationService } from './moderation.service';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

function makeClient() {
  return { send: jest.fn() };
}

function makeProxy() {
  return {
    forward: jest.fn(),
  } as unknown as jest.Mocked<RpcProxyService>;
}

describe('ModerationService (BFF)', () => {
  let client: ReturnType<typeof makeClient>;
  let proxy: jest.Mocked<RpcProxyService>;
  let service: ModerationService;

  beforeEach(() => {
    client = makeClient();
    proxy = makeProxy();
    service = new ModerationService(client as any, proxy as any);
  });

  describe('promote({roomId, userId, actorId})', () => {
    it('forwards rooms.members.promote', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce(undefined);

      await service.promote({ roomId: 1, userId: 2, actorId: 3 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'rooms.members.promote' },
        { roomId: 1, userId: 2, actorId: 3 },
      );
    });

    it('propagates FORBIDDEN when actor is not owner', async () => {
      const rpc = new RpcException({ status: 403, message: 'only owner can promote' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.promote({ roomId: 1, userId: 2, actorId: 3 })).rejects.toBe(rpc);
    });
  });

  describe('demote({roomId, userId, actorId})', () => {
    it('forwards rooms.members.demote', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce(undefined);

      await service.demote({ roomId: 1, userId: 2, actorId: 3 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'rooms.members.demote' },
        { roomId: 1, userId: 2, actorId: 3 },
      );
    });

    it('propagates NOT_FOUND', async () => {
      const rpc = new RpcException({ status: 404, message: 'member not found' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.demote({ roomId: 1, userId: 2, actorId: 3 })).rejects.toBe(rpc);
    });
  });

  describe('banMember({roomId, userId, actorId})', () => {
    it('forwards rooms.members.ban', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce(undefined);

      await service.banMember({ roomId: 1, userId: 2, actorId: 3 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'rooms.members.ban' },
        { roomId: 1, userId: 2, actorId: 3 },
      );
    });

    it('propagates FORBIDDEN', async () => {
      const rpc = new RpcException({ status: 403, message: 'insufficient role' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.banMember({ roomId: 1, userId: 2, actorId: 3 })).rejects.toBe(rpc);
    });
  });

  describe('unbanMember({roomId, userId, actorId})', () => {
    it('forwards rooms.bans.unban', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce(undefined);

      await service.unbanMember({ roomId: 1, userId: 2, actorId: 3 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'rooms.bans.unban' },
        { roomId: 1, userId: 2, actorId: 3 },
      );
    });
  });

  describe('listBans({roomId, actorId})', () => {
    it('forwards rooms.bans.list and returns the ban list', async () => {
      const bans = [{ userId: 7, reason: null }];
      (proxy.forward as jest.Mock).mockResolvedValueOnce(bans);

      const result = await service.listBans({ roomId: 1, actorId: 3 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'rooms.bans.list' },
        { roomId: 1, actorId: 3 },
      );
      expect(result).toEqual(bans);
    });

    it('propagates FORBIDDEN (non-mod viewer)', async () => {
      const rpc = new RpcException({ status: 403, message: 'moderator only' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.listBans({ roomId: 1, actorId: 3 })).rejects.toBe(rpc);
    });
  });

  describe('deleteRoom({roomId, actorId})', () => {
    it('forwards rooms.delete', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce(undefined);

      await service.deleteRoom({ roomId: 1, actorId: 3 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'rooms.delete' },
        { roomId: 1, actorId: 3 },
      );
    });

    it('propagates FORBIDDEN (non-owner)', async () => {
      const rpc = new RpcException({ status: 403, message: 'only owner can delete' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.deleteRoom({ roomId: 1, actorId: 3 })).rejects.toBe(rpc);
    });
  });
});
