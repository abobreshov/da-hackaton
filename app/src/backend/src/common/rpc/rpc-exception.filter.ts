import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';

/**
 * Global RpcExceptionFilter for the backend TCP microservice. Replaces the
 * per-module `toRpc(run)` helpers that previously lived under each module's
 * `rpc.util.ts` + the inline copies in `friends.tcp.ts` and `bans.tcp.ts`.
 *
 * Mapping contract:
 *   - HttpException  -> RpcException({ status, message, code?, details?, retryAfterMs? })
 *                       — status, message, and any structured extras (`code`,
 *                       `details`, `retryAfterMs`) are forwarded so the BFF's
 *                       `RpcErrorInterceptor` can rebuild the wire envelope.
 *   - RpcException   -> rethrow (SystemKeyRpcGuard and similar upstream layers
 *                       already emit RpcException; re-wrapping would double-wrap).
 *   - Error          -> RpcException({ status: 500, message, code: 'UPSTREAM_UNAVAILABLE' })
 *   - anything else  -> RpcException({ status: 500, message: 'Internal error',
 *                                       code: 'UPSTREAM_UNAVAILABLE' })
 *
 * The filter is a no-op on HTTP contexts: the Fastify HTTP surface (e.g.
 * `/health`) must keep surfacing HttpException through the default handler.
 * We detect this via `host.getType()` and rethrow unchanged.
 *
 * Return type is `Observable<never>` to match Nest's `RpcExceptionFilter`
 * contract (the dispatcher subscribes to the returned observable).
 */
@Catch()
export class RpcExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): Observable<never> {
    // HTTP routes must not be rewritten as RpcException — rethrow so Nest's
    // default HttpExceptionFilter can render the normal HTTP error body.
    if (host.getType?.() !== 'rpc') {
      return throwError(() => exception);
    }

    // Already in the wire envelope — don't double-wrap.
    if (exception instanceof RpcException) {
      return throwError(() => exception);
    }

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const status = exception.getStatus();

      let message: unknown;
      const envelope: Record<string, unknown> = {};

      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object') {
        const r = response as Record<string, unknown>;
        message = r.message ?? exception.message;
        if (typeof r.code === 'string') envelope.code = r.code;
        if (r.details !== undefined) envelope.details = r.details;
        if (typeof r.retryAfterMs === 'number') envelope.retryAfterMs = r.retryAfterMs;
      } else {
        message = exception.message;
      }

      return throwError(
        () =>
          new RpcException({
            status,
            message,
            ...envelope,
          }),
      );
    }

    if (exception instanceof Error) {
      return throwError(
        () =>
          new RpcException({
            status: 500,
            message: exception.message,
            code: 'UPSTREAM_UNAVAILABLE',
          }),
      );
    }

    return throwError(
      () =>
        new RpcException({
          status: 500,
          message: 'Internal error',
          code: 'UPSTREAM_UNAVAILABLE',
        }),
    );
  }
}
