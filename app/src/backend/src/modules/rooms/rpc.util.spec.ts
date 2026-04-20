/**
 * Characterization tests for `toRpc` — the error envelope used by rooms.tcp.ts.
 *
 * Mapping contract:
 *  - HttpException -> RpcException({ status: origin.status, message: origin.message })
 *  - Error         -> RpcException({ status: 500, message: err.message })
 *  - anything else -> RpcException({ status: 500, message: 'Internal error' })
 *  - success       -> returns the original value
 */

import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { toRpc } from './rpc.util';

describe('toRpc', () => {
  it('returns the resolved value on success', async () => {
    await expect(toRpc(() => Promise.resolve(42))).resolves.toBe(42);
    // Synchronous return is also supported.
    await expect(toRpc(() => 'hello')).resolves.toBe('hello');
  });

  it('wraps HttpException with getResponse() as string', async () => {
    class StringBodyHttp extends HttpException {
      constructor() {
        super('plain-body', 418);
      }
    }
    try {
      await toRpc(() => {
        throw new StringBodyHttp();
      });
      fail('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcException);
      expect(e.getError()).toMatchObject({ status: 418, message: 'plain-body' });
    }
  });

  it('wraps HttpException with object response containing message', async () => {
    try {
      await toRpc(() => {
        throw new BadRequestException('bad!');
      });
      fail('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcException);
      expect(e.getError()).toMatchObject({ status: 400, message: 'bad!' });
    }
  });

  it('falls back to err.message when response object has no message field', async () => {
    class WeirdHttp extends HttpException {
      constructor() {
        // Response is an object but without a `message` field.
        super({ foo: 'bar' }, 409);
      }
    }
    try {
      await toRpc(() => {
        throw new WeirdHttp();
      });
      fail('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcException);
      // message should fall back to err.message (HttpException default)
      expect(e.getError()).toMatchObject({ status: 409 });
    }
  });

  it('wraps ConflictException with body.message array preserved as-is', async () => {
    try {
      await toRpc(() => {
        throw new ConflictException(['a', 'b']);
      });
      fail('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcException);
      const err = e.getError() as any;
      expect(err.status).toBe(409);
      expect(err.message).toEqual(['a', 'b']);
    }
  });

  it('wraps plain Error as 500 with message (line 21-22)', async () => {
    try {
      await toRpc(() => {
        throw new Error('boom');
      });
      fail('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcException);
      expect(e.getError()).toMatchObject({ status: 500, message: 'boom' });
    }
  });

  it('wraps non-Error throws as 500 with generic message (lines 23-24)', async () => {
    try {
      await toRpc(() => {
        // eslint-disable-next-line no-throw-literal
        throw 'string-value';
      });
      fail('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcException);
      expect(e.getError()).toMatchObject({ status: 500, message: 'Internal error' });
    }
  });

  it('wraps a rejected promise consistently', async () => {
    await expect(
      toRpc(() => Promise.reject(new BadRequestException('async-bad'))),
    ).rejects.toBeInstanceOf(RpcException);
  });
});
