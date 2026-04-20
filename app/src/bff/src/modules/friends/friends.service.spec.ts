// Stub env so transitive imports (rpc-transport → environment) don't require
// real secrets at test time. Mirrors rooms.service.spec pattern.
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
import { FriendsService } from './friends.service';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

function makeClient() {
  return { send: jest.fn() };
}

function makeProxy() {
  return {
    forward: jest.fn(),
  } as unknown as jest.Mocked<RpcProxyService>;
}

describe('FriendsService (BFF)', () => {
  let client: ReturnType<typeof makeClient>;
  let proxy: jest.Mocked<RpcProxyService>;
  let service: FriendsService;

  beforeEach(() => {
    client = makeClient();
    proxy = makeProxy();
    service = new FriendsService(client as any, proxy as any);
  });

  describe('request({requesterId, targetUsername, text?})', () => {
    it('forwards friends.request with payload', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ id: 99 });

      const result = await service.request({
        requesterId: 3,
        targetUsername: 'bob',
        text: 'hi',
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'friends.request' },
        { requesterId: 3, targetUsername: 'bob', text: 'hi' },
      );
      expect(result).toEqual({ id: 99 });
    });

    it('omits text when not provided (still passes undefined)', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ id: 1 });

      await service.request({ requesterId: 3, targetUsername: 'bob' });

      const [, , payload] = (proxy.forward as jest.Mock).mock.calls[0];
      expect(payload).toMatchObject({ requesterId: 3, targetUsername: 'bob' });
    });

    it('propagates upstream RpcException (NOT_FOUND)', async () => {
      const rpc = new RpcException({ status: 404, message: 'user not found' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.request({ requesterId: 3, targetUsername: 'ghost' })).rejects.toBe(rpc);
    });
  });

  describe('accept({userId, requestId})', () => {
    it('forwards friends.accept with payload', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce(undefined);

      await service.accept({ userId: 3, requestId: 5 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'friends.accept' },
        { userId: 3, requestId: 5 },
      );
    });

    it('propagates upstream CONFLICT', async () => {
      const rpc = new RpcException({ status: 409, message: 'already handled' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.accept({ userId: 3, requestId: 5 })).rejects.toBe(rpc);
    });
  });

  describe('reject({userId, requestId})', () => {
    it('forwards friends.reject with payload', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce(undefined);

      await service.reject({ userId: 3, requestId: 5 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'friends.reject' },
        { userId: 3, requestId: 5 },
      );
    });

    it('propagates upstream NOT_FOUND', async () => {
      const rpc = new RpcException({ status: 404, message: 'no request' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.reject({ userId: 3, requestId: 5 })).rejects.toBe(rpc);
    });
  });

  describe('remove({userId, otherUserId})', () => {
    it('forwards friends.remove with payload', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce(undefined);

      await service.remove({ userId: 3, otherUserId: 4 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'friends.remove' },
        { userId: 3, otherUserId: 4 },
      );
    });

    it('propagates upstream NOT_FOUND', async () => {
      const rpc = new RpcException({ status: 404, message: 'no such friendship' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.remove({ userId: 3, otherUserId: 4 })).rejects.toBe(rpc);
    });
  });

  describe('list({userId})', () => {
    it('forwards friends.list with payload', async () => {
      const rows = [{ id: 1, friendId: 4, acceptedAt: new Date().toISOString() }];
      (proxy.forward as jest.Mock).mockResolvedValueOnce(rows);

      const out = await service.list({ userId: 3 });

      expect(proxy.forward).toHaveBeenCalledWith(client, { cmd: 'friends.list' }, { userId: 3 });
      expect(out).toBe(rows);
    });

    it('propagates upstream 504 UPSTREAM_UNAVAILABLE', async () => {
      const rpc = new RpcException({
        status: 504,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'upstream timeout',
      });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.list({ userId: 3 })).rejects.toBe(rpc);
    });
  });

  describe('listPending({userId})', () => {
    it('forwards friends.listPending with payload', async () => {
      const rows = [
        {
          id: 2,
          requesterId: 5,
          otherUserId: 5,
          incoming: true,
          requestText: 'hi',
          createdAt: new Date().toISOString(),
        },
      ];
      (proxy.forward as jest.Mock).mockResolvedValueOnce(rows);

      const out = await service.listPending({ userId: 3 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'friends.listPending' },
        { userId: 3 },
      );
      expect(out).toBe(rows);
    });

    it('propagates upstream error', async () => {
      const rpc = new RpcException({ status: 500, message: 'boom' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.listPending({ userId: 3 })).rejects.toBe(rpc);
    });
  });
});
