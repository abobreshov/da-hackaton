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

import { NEVER, of, throwError } from 'rxjs';
import { RpcException } from '@nestjs/microservices';
import { RpcProxyService } from './rpc-proxy.service';

function makeClient() {
  return {
    send: jest.fn(),
  };
}

describe('RpcProxyService', () => {
  let svc: RpcProxyService;
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    svc = new RpcProxyService();
    client = makeClient();
  });

  describe('forward()', () => {
    it('injects _sys envelope and resolves to upstream value on happy path', async () => {
      client.send.mockReturnValueOnce(of({ ok: true }));

      const result = await svc.forward(client as any, { cmd: 'x.y' }, { a: 1 });

      expect(result).toEqual({ ok: true });
      expect(client.send).toHaveBeenCalledTimes(1);
      const [pattern, payload] = client.send.mock.calls[0];
      expect(pattern).toEqual({ cmd: 'x.y' });
      expect(payload).toEqual({ a: 1, _sys: 'test-sys-key' });
    });

    it('supports string patterns as well as object patterns', async () => {
      client.send.mockReturnValueOnce(of('pong'));

      const result = await svc.forward<string>(client as any, 'ping', {});

      expect(result).toBe('pong');
      expect(client.send).toHaveBeenCalledWith(
        'ping',
        expect.objectContaining({ _sys: 'test-sys-key' }),
      );
    });

    it('passes empty payload ({}) and still injects _sys', async () => {
      client.send.mockReturnValueOnce(of([]));

      await svc.forward(client as any, { cmd: 'rooms.catalog' }, {});

      const [, payload] = client.send.mock.calls[0];
      expect(payload).toEqual({ _sys: 'test-sys-key' });
    });

    it('propagates upstream RpcException verbatim (no wrapping, no try/catch)', async () => {
      const rpc = new RpcException({ status: 409, code: 'CONFLICT', message: 'dup' });
      client.send.mockReturnValueOnce(throwError(() => rpc));

      await expect(svc.forward(client as any, { cmd: 'x' }, {})).rejects.toBe(rpc);
    });

    it('propagates non-RpcException errors verbatim', async () => {
      const err = new Error('boom');
      client.send.mockReturnValueOnce(throwError(() => err));

      await expect(svc.forward(client as any, { cmd: 'x' }, {})).rejects.toBe(err);
    });

    describe('timeout', () => {
      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('rejects with RpcException 504 UPSTREAM_UNAVAILABLE after default 5000ms', async () => {
        client.send.mockReturnValueOnce(NEVER);

        const promise = svc.forward(client as any, { cmd: 'slow' }, {});
        const caught = promise.catch((e: unknown) => e);

        await jest.advanceTimersByTimeAsync(5000);

        const err = await caught;
        expect(err).toBeInstanceOf(RpcException);
        const payload = (err as RpcException).getError() as {
          status: number;
          code: string;
          message: string;
        };
        expect(payload).toEqual({
          status: 504,
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'upstream timeout',
        });
      });

      it('does not time out just before the deadline (4999ms)', async () => {
        client.send.mockReturnValueOnce(NEVER);

        const promise = svc.forward(client as any, { cmd: 'slow' }, {});
        let settled = false;
        promise.catch(() => {
          settled = true;
        });

        await jest.advanceTimersByTimeAsync(4999);
        expect(settled).toBe(false);

        // Finish it off to avoid unhandled-rejection warnings.
        await jest.advanceTimersByTimeAsync(2);
        await Promise.resolve();
      });

      it('honours a custom timeoutMs override', async () => {
        client.send.mockReturnValueOnce(NEVER);

        const promise = svc.forward(client as any, { cmd: 'slow' }, {}, { timeoutMs: 1000 });
        const caught = promise.catch((e: unknown) => e);

        await jest.advanceTimersByTimeAsync(1000);

        const err = await caught;
        expect(err).toBeInstanceOf(RpcException);
        expect((err as RpcException).getError()).toMatchObject({
          status: 504,
          code: 'UPSTREAM_UNAVAILABLE',
        });
      });
    });
  });
});
