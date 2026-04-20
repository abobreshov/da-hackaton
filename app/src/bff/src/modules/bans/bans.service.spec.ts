// Stub env so transitive imports (rpc-transport → environment) don't require
// real secrets at test time.
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
import { BansService } from './bans.service';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

function makeClient() {
  return { send: jest.fn() };
}

function makeProxy() {
  return {
    forward: jest.fn(),
  } as unknown as jest.Mocked<RpcProxyService>;
}

describe('BansService (BFF)', () => {
  let client: ReturnType<typeof makeClient>;
  let proxy: jest.Mocked<RpcProxyService>;
  let service: BansService;

  beforeEach(() => {
    client = makeClient();
    proxy = makeProxy();
    service = new BansService(client as any, proxy as any);
  });

  describe('ban({bannerId, bannedId})', () => {
    it('forwards users.ban with payload', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ ok: true });

      const result = await service.ban({ bannerId: 3, bannedId: 4 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'users.ban' },
        { bannerId: 3, bannedId: 4 },
      );
      expect(result).toEqual({ ok: true });
    });

    it('propagates BAD_REQUEST (self-ban)', async () => {
      const rpc = new RpcException({ status: 400, message: 'cannot ban yourself' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.ban({ bannerId: 1, bannedId: 1 })).rejects.toBe(rpc);
    });
  });

  describe('unban({bannerId, bannedId})', () => {
    it('forwards users.unban with payload', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce(undefined);

      await service.unban({ bannerId: 3, bannedId: 4 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'users.unban' },
        { bannerId: 3, bannedId: 4 },
      );
    });

    it('propagates NOT_FOUND from upstream', async () => {
      const rpc = new RpcException({ status: 404, message: 'no ban record' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.unban({ bannerId: 3, bannedId: 4 })).rejects.toBe(rpc);
    });

    it('propagates timeout (504 UPSTREAM_UNAVAILABLE)', async () => {
      const rpc = new RpcException({
        status: 504,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'upstream timeout',
      });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.unban({ bannerId: 3, bannedId: 4 })).rejects.toBe(rpc);
    });
  });

  describe('listBans({userId})', () => {
    it('forwards users.listBans with payload', async () => {
      const rows = [{ bannedId: 7, createdAt: new Date().toISOString() }];
      (proxy.forward as jest.Mock).mockResolvedValueOnce(rows);

      const out = await service.listBans({ userId: 3 });

      expect(proxy.forward).toHaveBeenCalledWith(client, { cmd: 'users.listBans' }, { userId: 3 });
      expect(out).toBe(rows);
    });

    it('propagates upstream error', async () => {
      const rpc = new RpcException({ status: 500, message: 'boom' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.listBans({ userId: 3 })).rejects.toBe(rpc);
    });
  });
});
