import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';

/**
 * Global RpcExceptionFilter for auth-service's TCP microservice. Replaces the
 * `toRpc(run)` helper under `common/rpc-exception.util.ts` that every TCP
 * controller previously wrapped every handler with.
 *
 * Mapping contract:
 *   - HttpException  -> RpcException({ status, message, code?, details?, retryAfterMs? })
 *                       — status, message, and structured extras (`code`,
 *                       `details`, `retryAfterMs`) forward so the BFF's
 *                       `RpcErrorInterceptor` can rebuild the wire envelope.
 *   - RpcException   -> rethrow (already wrapped upstream; avoid double-wrap).
 *   - Error          -> RpcException({ status: 500, message, code: 'UPSTREAM_UNAVAILABLE' })
 *   - anything else  -> RpcException({ status: 500, message: 'Internal error',
 *                                       code: 'UPSTREAM_UNAVAILABLE' })
 *
 * The filter is a no-op on HTTP contexts: the auth-service is a hybrid HTTP +
 * TCP app and the Fastify routes must still return normal HTTP error bodies.
 * We detect via `host.getType()` and rethrow the original exception unchanged.
 */
@Catch()
export class RpcExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): Observable<never> {
    if (host.getType?.() !== 'rpc') {
      return throwError(() => exception);
    }

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
