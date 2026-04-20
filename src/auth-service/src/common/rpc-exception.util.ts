import { HttpException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

export function toRpc<T>(run: () => Promise<T> | T): Promise<T> {
  return Promise.resolve()
    .then(run)
    .catch((err: unknown) => {
      if (err instanceof HttpException) {
        const res = err.getResponse();
        const message = typeof res === 'string' ? res : (res as any)?.message ?? err.message;
        throw new RpcException({ status: err.getStatus(), message });
      }
      if (err instanceof Error) {
        throw new RpcException({ status: 500, message: err.message });
      }
      throw new RpcException({ status: 500, message: 'Internal error' });
    });
}
