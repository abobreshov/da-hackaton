// Stub env so transitive imports (rpc-transport → environment) don't require
// real secrets at test time. Mirrors friends/bans spec pattern.
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
import { MessagesService } from './messages.service';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

function makeClient() {
  return { send: jest.fn() };
}

function makeProxy() {
  return {
    forward: jest.fn(),
  } as unknown as jest.Mocked<RpcProxyService>;
}

describe('MessagesService (BFF)', () => {
  let client: ReturnType<typeof makeClient>;
  let proxy: jest.Mocked<RpcProxyService>;
  let service: MessagesService;

  beforeEach(() => {
    client = makeClient();
    proxy = makeProxy();
    service = new MessagesService(client as any, proxy as any);
  });

  describe('create({authorId, roomId?, dmUserId?, body, replyToId?})', () => {
    it('forwards messages.create with full room payload', async () => {
      const created = { id: '101', roomId: 5, authorId: 7, body: 'hello' };
      (proxy.forward as jest.Mock).mockResolvedValueOnce(created);

      const result = await service.create({
        authorId: 7,
        roomId: 5,
        body: 'hello',
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'messages.create' },
        { authorId: 7, roomId: 5, body: 'hello' },
      );
      expect(result).toEqual(created);
    });

    it('forwards messages.create with dmUserId + replyToId', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ id: '202' });

      await service.create({
        authorId: 3,
        dmUserId: 4,
        body: 'replying',
        replyToId: '200',
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'messages.create' },
        { authorId: 3, dmUserId: 4, body: 'replying', replyToId: '200' },
      );
    });

    it('propagates FORBIDDEN from upstream (not a room member)', async () => {
      const rpc = new RpcException({ status: 403, message: 'not a member' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.create({ authorId: 1, roomId: 2, body: 'x' })).rejects.toBe(rpc);
    });

    it('propagates 504 UPSTREAM_UNAVAILABLE (timeout)', async () => {
      const rpc = new RpcException({
        status: 504,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'upstream timeout',
      });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.create({ authorId: 1, roomId: 2, body: 'x' })).rejects.toBe(rpc);
    });
  });

  describe('list({roomId?, dmUserId?, beforeCreatedAt?, beforeId?, limit})', () => {
    it('forwards messages.list with roomId + cursor', async () => {
      const rows = [{ id: '50' }, { id: '49' }];
      (proxy.forward as jest.Mock).mockResolvedValueOnce(rows);

      const result = await service.list({
        roomId: 5,
        beforeCreatedAt: '2026-04-20T10:00:00Z',
        beforeId: '60',
        limit: 25,
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'messages.list' },
        {
          roomId: 5,
          beforeCreatedAt: '2026-04-20T10:00:00Z',
          beforeId: '60',
          limit: 25,
        },
      );
      expect(result).toBe(rows);
    });

    it('forwards messages.list with dmUserId only (no cursor)', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce([]);

      await service.list({ dmUserId: 4, limit: 50 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'messages.list' },
        { dmUserId: 4, limit: 50 },
      );
    });

    it('propagates FORBIDDEN (not a member) from upstream', async () => {
      const rpc = new RpcException({ status: 403, message: 'not a member' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.list({ roomId: 5, limit: 50 })).rejects.toBe(rpc);
    });
  });

  describe('edit({messageId, actorId, body})', () => {
    it('forwards messages.edit with payload', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ id: '101', body: 'fix' });

      const result = await service.edit({ messageId: '101', actorId: 7, body: 'fix' });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'messages.edit' },
        { messageId: '101', actorId: 7, body: 'fix' },
      );
      expect(result).toEqual({ id: '101', body: 'fix' });
    });

    it('propagates FORBIDDEN (not the author)', async () => {
      const rpc = new RpcException({ status: 403, message: 'not the author' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.edit({ messageId: '101', actorId: 9, body: 'x' })).rejects.toBe(rpc);
    });
  });

  describe('delete({messageId, actorId})', () => {
    it('forwards messages.delete with payload', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce(undefined);

      await service.delete({ messageId: '101', actorId: 7 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'messages.delete' },
        { messageId: '101', actorId: 7 },
      );
    });

    it('propagates NOT_FOUND from upstream', async () => {
      const rpc = new RpcException({ status: 404, message: 'no such message' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.delete({ messageId: '999', actorId: 7 })).rejects.toBe(rpc);
    });
  });

  describe('getById({messageId, actorId})', () => {
    it('forwards messages.getById with payload', async () => {
      const row = { id: '101', body: 'hi' };
      (proxy.forward as jest.Mock).mockResolvedValueOnce(row);

      const result = await service.getById({ messageId: '101', actorId: 7 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'messages.getById' },
        { messageId: '101', actorId: 7 },
      );
      expect(result).toBe(row);
    });

    it('propagates FORBIDDEN (not a member of room)', async () => {
      const rpc = new RpcException({ status: 403, message: 'not a member' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.getById({ messageId: '101', actorId: 9 })).rejects.toBe(rpc);
    });
  });

  describe('since({roomId?, dmUserId?, sinceCreatedAt, sinceId, limit})', () => {
    it('forwards messages.since with payload', async () => {
      const rows = [{ id: '70' }];
      (proxy.forward as jest.Mock).mockResolvedValueOnce(rows);

      const result = await service.since({
        roomId: 5,
        sinceCreatedAt: '2026-04-20T09:00:00Z',
        sinceId: '60',
        limit: 50,
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'messages.since' },
        {
          roomId: 5,
          sinceCreatedAt: '2026-04-20T09:00:00Z',
          sinceId: '60',
          limit: 50,
        },
      );
      expect(result).toBe(rows);
    });

    it('forwards messages.since with dmUserId', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce([]);

      await service.since({
        dmUserId: 4,
        sinceCreatedAt: '2026-04-20T09:00:00Z',
        sinceId: '60',
        limit: 50,
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'messages.since' },
        {
          dmUserId: 4,
          sinceCreatedAt: '2026-04-20T09:00:00Z',
          sinceId: '60',
          limit: 50,
        },
      );
    });

    it('propagates upstream RpcException unchanged', async () => {
      const rpc = new RpcException({ status: 500, message: 'boom' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(
        service.since({ roomId: 5, sinceCreatedAt: 'x', sinceId: '1', limit: 10 }),
      ).rejects.toBe(rpc);
    });
  });
});
