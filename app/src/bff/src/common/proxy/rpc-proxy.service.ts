import { Injectable } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { TimeoutError, firstValueFrom, timeout } from 'rxjs';
import { withSys } from '../rpc-transport';

export interface ForwardOptions {
  /**
   * Upstream call deadline in milliseconds. On expiry, `forward` rejects with
   * `RpcException({ status: 504, code: 'UPSTREAM_UNAVAILABLE' })`. Defaults to
   * 5000ms.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Generic BFF → upstream microservice proxy.
 *
 * Absorbs the boilerplate every BFF proxy service repeats:
 *   - wraps the outgoing payload in the shared-secret envelope (`withSys`)
 *   - subscribes to the `ClientProxy` observable and returns a `Promise`
 *   - enforces an upstream deadline and maps RxJS `TimeoutError` →
 *     `RpcException({ status: 504, code: 'UPSTREAM_UNAVAILABLE' })`
 *
 * Upstream `RpcException`s and any other error flavours are intentionally
 * allowed to bubble — the global `RpcErrorInterceptor` owns the HTTP envelope
 * translation. Never `try/catch` around upstream errors here.
 */
@Injectable()
export class RpcProxyService {
  async forward<T>(
    client: ClientProxy,
    pattern: unknown,
    payload: object,
    opts: ForwardOptions = {},
  ): Promise<T> {
    const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      return await firstValueFrom(
        client.send<T>(pattern as never, withSys(payload)).pipe(timeout(ms)),
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        throw new RpcException({
          status: 504,
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'upstream timeout',
        });
      }
      throw err;
    }
  }
}
