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
import { ReportsService } from './reports.service';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

function makeClient() {
  return { send: jest.fn() };
}

function makeProxy() {
  return { forward: jest.fn() } as unknown as jest.Mocked<RpcProxyService>;
}

describe('ReportsService (BFF)', () => {
  let client: ReturnType<typeof makeClient>;
  let proxy: jest.Mocked<RpcProxyService>;
  let service: ReportsService;

  beforeEach(() => {
    client = makeClient();
    proxy = makeProxy();
    service = new ReportsService(client as any, proxy as any);
  });

  describe('create({reporterId, targetType, targetId, reason})', () => {
    it('forwards reports.create with full payload', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ id: '42' });

      const result = await service.create({
        reporterId: 3,
        targetType: 'message',
        targetId: 7,
        reason: 'spam',
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'reports.create' },
        { reporterId: 3, targetType: 'message', targetId: 7, reason: 'spam' },
      );
      expect(result).toEqual({ id: '42' });
    });

    it('propagates NOT_FOUND (target missing)', async () => {
      const rpc = new RpcException({ status: 404, message: 'target not found' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(
        service.create({ reporterId: 1, targetType: 'user', targetId: 999, reason: 'x' }),
      ).rejects.toBe(rpc);
    });
  });

  describe('resolve({id, adminId, note?})', () => {
    it('forwards reports.resolve with payload', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ ok: true });

      await service.resolve({ id: '42', adminId: 1, note: 'handled' });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'reports.resolve' },
        { id: '42', adminId: 1, note: 'handled' },
      );
    });

    it('omits note when not provided', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ ok: true });
      await service.resolve({ id: '42', adminId: 1 });
      const [, , payload] = (proxy.forward as jest.Mock).mock.calls[0];
      expect(payload).toMatchObject({ id: '42', adminId: 1 });
    });

    it('propagates CONFLICT (already resolved)', async () => {
      const rpc = new RpcException({ status: 409, message: 'already resolved' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.resolve({ id: '42', adminId: 1 })).rejects.toBe(rpc);
    });
  });

  describe('dismiss({id, adminId, note?})', () => {
    it('forwards reports.dismiss with payload', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ ok: true });

      await service.dismiss({ id: '42', adminId: 1, note: 'noise' });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'reports.dismiss' },
        { id: '42', adminId: 1, note: 'noise' },
      );
    });

    it('propagates NOT_FOUND', async () => {
      const rpc = new RpcException({ status: 404, message: 'report not found' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.dismiss({ id: '42', adminId: 1 })).rejects.toBe(rpc);
    });
  });

  describe('list({adminId, limit, beforeCreatedAt?, beforeId?})', () => {
    it('forwards reports.list with full payload (no cursor)', async () => {
      const rows = [{ id: '1' }, { id: '2' }];
      (proxy.forward as jest.Mock).mockResolvedValueOnce(rows);

      const out = await service.list({ adminId: 9, limit: 25 });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'reports.list' },
        { adminId: 9, limit: 25 },
      );
      expect(out).toBe(rows);
    });

    it('forwards reports.list with cursor fields', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce([]);

      await service.list({
        adminId: 9,
        limit: 50,
        beforeCreatedAt: '2026-04-20T10:00:00.000Z',
        beforeId: '123',
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'reports.list' },
        {
          adminId: 9,
          limit: 50,
          beforeCreatedAt: '2026-04-20T10:00:00.000Z',
          beforeId: '123',
        },
      );
    });

    it('propagates FORBIDDEN (non-admin upstream)', async () => {
      const rpc = new RpcException({ status: 403, message: 'admin required' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.list({ adminId: 9, limit: 10 })).rejects.toBe(rpc);
    });
  });
});
