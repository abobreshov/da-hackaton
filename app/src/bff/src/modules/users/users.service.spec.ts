// Stub env so transitive imports (microservice.module → environment) don't
// require real secrets at test time. Mirrors RoomsService spec pattern.
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

import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

function makeClient() {
  return { send: jest.fn() };
}

function makeProxy() {
  return { forward: jest.fn() } as unknown as jest.Mocked<RpcProxyService>;
}

describe('UsersService (BFF)', () => {
  let client: ReturnType<typeof makeClient>;
  let proxy: jest.Mocked<RpcProxyService>;
  let service: UsersService;

  beforeEach(() => {
    client = makeClient();
    proxy = makeProxy();
    service = new UsersService(client as any, proxy as any);
  });

  describe('list()', () => {
    it('forwards users.list via RpcProxy', async () => {
      const rows = [{ id: 1, name: 'alice' }];
      (proxy.forward as jest.Mock).mockResolvedValueOnce(rows);

      const result = await service.list();

      expect(proxy.forward).toHaveBeenCalledWith(client, { cmd: 'users.list' }, {});
      expect(result).toEqual(rows);
    });
  });

  describe('findById(id)', () => {
    it('forwards users.findById with {id} payload', async () => {
      const row = { id: 1, name: 'alice' };
      (proxy.forward as jest.Mock).mockResolvedValueOnce(row);

      const result = await service.findById(1);

      expect(proxy.forward).toHaveBeenCalledWith(client, { cmd: 'users.findById' }, { id: 1 });
      expect(result).toEqual(row);
    });
  });

  describe('resolveUserIdByUsername(username)', () => {
    it('returns {userId,found:true} when backend resolves a row', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ id: 2, name: 'bob' });

      await expect(service.resolveUserIdByUsername('bob')).resolves.toEqual({
        userId: 2,
        found: true,
      });
      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'users.findByUsername' },
        { username: 'bob' },
      );
    });

    it('trims whitespace before forwarding', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce({ id: 9, name: 'charlie' });

      await expect(service.resolveUserIdByUsername('  charlie  ')).resolves.toEqual({
        userId: 9,
        found: true,
      });
      expect(proxy.forward).toHaveBeenCalledWith(
        client,
        { cmd: 'users.findByUsername' },
        { username: 'charlie' },
      );
    });

    it('returns {userId:null,found:false} when backend returns null', async () => {
      (proxy.forward as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.resolveUserIdByUsername('ghost')).resolves.toEqual({
        userId: null,
        found: false,
      });
    });

    it('throws BadRequestException without hitting upstream when username is empty', async () => {
      await expect(service.resolveUserIdByUsername('   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(proxy.forward).not.toHaveBeenCalled();
    });

    it('propagates RPC errors verbatim', async () => {
      const err = new Error('upstream down');
      (proxy.forward as jest.Mock).mockRejectedValueOnce(err);
      await expect(service.resolveUserIdByUsername('alice')).rejects.toBe(err);
    });
  });
});
