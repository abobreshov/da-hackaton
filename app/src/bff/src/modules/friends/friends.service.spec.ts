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
import { UsersService } from '../users/users.service';

function makeClient() {
  return { send: jest.fn() };
}

function makeProxy() {
  return {
    forward: jest.fn(),
  } as unknown as jest.Mocked<RpcProxyService>;
}

function makeUsers() {
  return { findManyByIds: jest.fn() } as unknown as jest.Mocked<UsersService>;
}

describe('FriendsService (BFF)', () => {
  let client: ReturnType<typeof makeClient>;
  let proxy: jest.Mocked<RpcProxyService>;
  let users: jest.Mocked<UsersService>;
  let service: FriendsService;

  beforeEach(() => {
    client = makeClient();
    proxy = makeProxy();
    users = makeUsers();
    service = new FriendsService(client as any, proxy as any, users as any);
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

  describe('listEnvelope({userId})', () => {
    it('combines accepted + pending rows and hydrates usernames in one users.listByIds call', async () => {
      // friends.list → 2 accepted friends (ids 4 + 5)
      // friends.listPending → 1 incoming (from 6) + 1 outgoing (to 7)
      (proxy.forward as jest.Mock)
        .mockResolvedValueOnce([
          { id: 100, friendId: 4, acceptedAt: '2026-04-21T00:00:00.000Z' },
          { id: 101, friendId: 5, acceptedAt: '2026-04-21T00:00:00.000Z' },
        ])
        .mockResolvedValueOnce([
          {
            id: 200,
            requesterId: 6,
            otherUserId: 6,
            incoming: true,
            requestText: 'hey',
            createdAt: '2026-04-21T00:00:00.000Z',
          },
          {
            id: 201,
            requesterId: 3,
            otherUserId: 7,
            incoming: false,
            requestText: null,
            createdAt: '2026-04-21T00:00:00.000Z',
          },
        ]);

      users.findManyByIds.mockResolvedValueOnce(
        new Map<number, string>([
          [4, 'alice'],
          [5, 'bob'],
          [6, 'carol'],
          [7, 'dave'],
        ]),
      );

      const out = await service.listEnvelope({ userId: 3 });

      expect(users.findManyByIds).toHaveBeenCalledTimes(1);
      // Single hydration call covers every distinct id we will render — order
      // is irrelevant but the set must match exactly.
      const [idsArg] = users.findManyByIds.mock.calls[0];
      expect(new Set(idsArg)).toEqual(new Set([4, 5, 6, 7]));

      expect(out).toEqual({
        friends: [
          { userId: 4, username: 'alice' },
          { userId: 5, username: 'bob' },
        ],
        incoming: [{ id: 200, from: { userId: 6, username: 'carol' } }],
        outgoing: [{ id: 201, to: { userId: 7, username: 'dave' } }],
      });
    });

    it('substitutes "unknown" when a referenced user id is missing from hydration', async () => {
      (proxy.forward as jest.Mock)
        .mockResolvedValueOnce([{ id: 1, friendId: 99, acceptedAt: null }])
        .mockResolvedValueOnce([]);
      // Map intentionally empty — id 99 was deleted between rows being read
      // and the hydration call. Row should still surface, with placeholder.
      users.findManyByIds.mockResolvedValueOnce(new Map());

      const out = await service.listEnvelope({ userId: 3 });

      expect(out.friends).toEqual([{ userId: 99, username: 'unknown' }]);
      expect(out.incoming).toEqual([]);
      expect(out.outgoing).toEqual([]);
    });

    it('returns empty envelope (no hydration call) when there are no rows at all', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      users.findManyByIds.mockResolvedValueOnce(new Map());

      const out = await service.listEnvelope({ userId: 3 });

      expect(out).toEqual({ friends: [], incoming: [], outgoing: [] });
      // hydration is still invoked with [] — UsersService short-circuits without an upstream call.
      expect(users.findManyByIds).toHaveBeenCalledWith([]);
    });
  });
});
