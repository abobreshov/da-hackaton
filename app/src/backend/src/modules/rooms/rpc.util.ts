import { HttpException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

/**
 * Wraps a service call so HttpException-kind failures surface as RpcException
 * on the TCP boundary. Mirrors `auth-service/src/common/rpc-exception.util.ts`
 * so the BFF's `RpcErrorInterceptor` sees a consistent envelope across
 * services. Kept local to the rooms module — extract if a second backend
 * module needs the same thing.
 */
export function toRpc<T>(run: () => Promise<T> | T): Promise<T> {
  return Promise.resolve()
    .then(run)
    .catch((err: unknown) => {
      if (err instanceof HttpException) {
        const res = err.getResponse();
        const message =
          typeof res === 'string' ? res : ((res as { message?: unknown })?.message ?? err.message);
        throw new RpcException({ status: err.getStatus(), message });
      }
      if (err instanceof Error) {
        throw new RpcException({ status: 500, message: err.message });
      }
      throw new RpcException({ status: 500, message: 'Internal error' });
    });
}
