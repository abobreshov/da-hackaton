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
import { AuditService } from './audit.service';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

function makeClient() {
  return { send: jest.fn() };
}

function makeProxy() {
  return { forward: jest.fn() } as unknown as jest.Mocked<RpcProxyService>;
}

describe('AuditService (BFF)', () => {
  let client: ReturnType<typeof makeClient>;
  let proxy: jest.Mocked<RpcProxyService>;
  let service: AuditService;

  beforeEach(() => {
    client = makeClient();
    proxy = makeProxy();
    service = new AuditService(client as any, proxy as any);
  });

  describe('page({...filters})', () => {
    it('forwards audit.page with full filter payload', async () => {
      const rows = [{ id: '9', action: 'rooms.delete' }];
      (proxy.forward as jest.Mock).mockResolvedValueOnce(rows);

      const from = '2026-04-01T00:00:00Z';
      const to = '2026-04-20T00:00:00Z';
      const result = await service.page({
        actor: 3,
        action: 'rooms.delete',
        from,
        to,
        limit: 50,
        before: { createdAt: to, id: '42' },
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'audit.page' },
        {
          actor: 3,
          action: 'rooms.delete',
          from,
          to,
          limit: 50,
          before: { createdAt: to, id: '42' },
        },
      );
      expect(result).toEqual(rows);
    });

    it('passes an empty object when no filters are supplied (still forwards)', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce([]);

      await service.page({});

      expect(proxy.forward).toHaveBeenCalledWith(client, { cmd: 'audit.page' }, {});
    });

    it('propagates upstream RpcException (e.g. 500)', async () => {
      const rpc = new RpcException({ status: 500, message: 'db error' });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.page({ limit: 10 })).rejects.toBe(rpc);
    });

    it('propagates upstream 504 UPSTREAM_UNAVAILABLE (timeout from proxy)', async () => {
      const rpc = new RpcException({
        status: 504,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'upstream timeout',
      });
      (proxy.forward as jest.Mock).mockRejectedValueOnce(rpc);
      await expect(service.page({ limit: 50 })).rejects.toBe(rpc);
    });
  });
});
