import { BadRequestException, HttpException, InternalServerErrorException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { toRpc } from './rpc-exception.util';

describe('toRpc', () => {
  it('passes through resolved values', async () => {
    await expect(toRpc(() => 42)).resolves.toBe(42);
    await expect(toRpc(async () => 'ok')).resolves.toBe('ok');
  });

  it('converts HttpException to RpcException preserving status and message', async () => {
    const run = () => {
      throw new BadRequestException('bad payload');
    };
    await expect(toRpc(run)).rejects.toMatchObject({
      error: { status: 400, message: 'bad payload' },
    });
  });

  it('unwraps object-response message from HttpException', async () => {
    const run = () => {
      throw new HttpException({ message: 'nope' }, 418);
    };
    await expect(toRpc(run)).rejects.toBeInstanceOf(RpcException);
    await expect(toRpc(run)).rejects.toMatchObject({ error: { status: 418, message: 'nope' } });
  });

  it('wraps generic Error as 500', async () => {
    const run = () => {
      throw new Error('boom');
    };
    await expect(toRpc(run)).rejects.toMatchObject({ error: { status: 500, message: 'boom' } });
  });

  it('wraps non-Error throwables as 500 Internal error', async () => {
    const run = () => {
      throw 'plain string';
    };
    await expect(toRpc(run)).rejects.toMatchObject({
      error: { status: 500, message: 'Internal error' },
    });
  });

  it('distinguishes 5xx HttpException from generic Error', async () => {
    const run = () => {
      throw new InternalServerErrorException('db down');
    };
    await expect(toRpc(run)).rejects.toMatchObject({
      error: { status: 500, message: 'db down' },
    });
  });
});
