/**
 * Characterization tests for auth-service's `RpcExceptionFilter` — the global
 * microservice filter that translates domain `HttpException`s thrown from
 * service methods into `RpcException` envelopes consumable by the BFF's
 * `RpcErrorInterceptor`.
 *
 * Mapping contract (replaces `common/rpc-exception.util.ts#toRpc`):
 *  - HttpException            -> RpcException({ status, message, code?, details?, retryAfterMs? })
 *  - RpcException             -> rethrow (already wrapped upstream)
 *  - Error                    -> RpcException({ status: 500, message, code: 'UPSTREAM_UNAVAILABLE' })
 *  - anything else (string..) -> RpcException({ status: 500, message: 'Internal error' })
 *
 * The filter is a no-op on HTTP contexts: the hybrid Fastify app must still
 * surface HttpException normally on REST routes.
 */

import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { RpcExceptionFilter } from './rpc-exception.filter';

function rpcHost(): ArgumentsHost {
  return {
    getType: () => 'rpc',
    switchToRpc: () => ({ getData: () => ({}), getContext: () => ({}) }),
  } as unknown as ArgumentsHost;
}

function httpHost(): ArgumentsHost {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
  } as unknown as ArgumentsHost;
}

async function expectRpcReject<T = unknown>(
  obs$: unknown,
): Promise<RpcException & { getError: () => T }> {
  try {
    await firstValueFrom(obs$ as any);
    throw new Error('expected observable to error');
  } catch (e: any) {
    if (!(e instanceof RpcException)) {
      throw new Error(`expected RpcException, got ${e?.constructor?.name}: ${e?.message ?? e}`);
    }
    return e as RpcException & { getError: () => T };
  }
}

describe('RpcExceptionFilter (auth-service)', () => {
  let filter: RpcExceptionFilter;

  beforeEach(() => {
    filter = new RpcExceptionFilter();
  });

  it('maps BadRequestException (400) preserving message', async () => {
    const e = await expectRpcReject<{ status: number; message: string }>(
      filter.catch(new BadRequestException('bad payload'), rpcHost()),
    );
    expect(e.getError()).toMatchObject({ status: 400, message: 'bad payload' });
  });

  it('maps UnauthorizedException (401) preserving message', async () => {
    const e = await expectRpcReject<{ status: number; message: string }>(
      filter.catch(new UnauthorizedException('bad creds'), rpcHost()),
    );
    expect(e.getError()).toMatchObject({ status: 401, message: 'bad creds' });
  });

  it('maps ForbiddenException (403) preserving message', async () => {
    const e = await expectRpcReject<{ status: number; message: string }>(
      filter.catch(new ForbiddenException('no admin'), rpcHost()),
    );
    expect(e.getError()).toMatchObject({ status: 403, message: 'no admin' });
  });

  it('maps NotFoundException (404) preserving message', async () => {
    const e = await expectRpcReject<{ status: number; message: string }>(
      filter.catch(new NotFoundException('user gone'), rpcHost()),
    );
    expect(e.getError()).toMatchObject({ status: 404, message: 'user gone' });
  });

  it('maps ConflictException (409) preserving message', async () => {
    const e = await expectRpcReject<{ status: number; message: string }>(
      filter.catch(new ConflictException('email taken'), rpcHost()),
    );
    expect(e.getError()).toMatchObject({ status: 409, message: 'email taken' });
  });

  it('maps 429 Too Many Requests preserving message', async () => {
    const e = await expectRpcReject<{ status: number; message: string }>(
      filter.catch(new HttpException('rate limit', HttpStatus.TOO_MANY_REQUESTS), rpcHost()),
    );
    expect(e.getError()).toMatchObject({ status: 429, message: 'rate limit' });
  });

  it('preserves string-body HttpException message', async () => {
    const e = await expectRpcReject<{ status: number; message: string }>(
      filter.catch(new HttpException('plain-body', 418), rpcHost()),
    );
    expect(e.getError()).toMatchObject({ status: 418, message: 'plain-body' });
  });

  it('unwraps object-body message (Nest array-of-strings shape)', async () => {
    const e = await expectRpcReject<{ status: number; message: string[] }>(
      filter.catch(new BadRequestException(['name required']), rpcHost()),
    );
    expect(e.getError()).toMatchObject({
      status: 400,
      message: ['name required'],
    });
  });

  it('propagates `code`, `details`, `retryAfterMs` from an object response', async () => {
    const e = await expectRpcReject<Record<string, unknown>>(
      filter.catch(
        new HttpException(
          {
            message: 'rate limited',
            code: 'RATE_LIMITED',
            retryAfterMs: 500,
            details: { scope: 'login' },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        ),
        rpcHost(),
      ),
    );
    expect(e.getError()).toMatchObject({
      status: 429,
      message: 'rate limited',
      code: 'RATE_LIMITED',
      retryAfterMs: 500,
      details: { scope: 'login' },
    });
  });

  it('rethrows RpcException unchanged', async () => {
    const original = new RpcException({ status: 401, message: 'bad _sys' });
    const rethrown = await expectRpcReject(filter.catch(original, rpcHost()));
    expect(rethrown).toBe(original);
  });

  it('wraps plain Error as 500 with UPSTREAM_UNAVAILABLE code', async () => {
    const e = await expectRpcReject<{ status: number; message: string; code: string }>(
      filter.catch(new Error('boom'), rpcHost()),
    );
    expect(e.getError()).toMatchObject({
      status: 500,
      message: 'boom',
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('wraps 5xx HttpException as RpcException with the real 5xx status', async () => {
    const e = await expectRpcReject<{ status: number; message: string }>(
      filter.catch(new InternalServerErrorException('db down'), rpcHost()),
    );
    expect(e.getError()).toMatchObject({ status: 500, message: 'db down' });
    // Not tagged UPSTREAM_UNAVAILABLE because it's a proper HttpException.
    expect((e.getError() as { code?: string }).code).toBeUndefined();
  });

  it('wraps non-Error throwable (string) as 500 Internal error', async () => {
    const e = await expectRpcReject<{ status: number; message: string; code: string }>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filter.catch('plain string' as any, rpcHost()),
    );
    expect(e.getError()).toMatchObject({
      status: 500,
      message: 'Internal error',
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('tolerates null / undefined by emitting a generic 500 envelope', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = await expectRpcReject(filter.catch(null as any, rpcHost()));
    expect(a.getError()).toMatchObject({ status: 500, message: 'Internal error' });
  });

  it('rethrows HttpException unchanged when host.getType() is "http"', async () => {
    const e = new BadRequestException('browser-facing');
    await expect(firstValueFrom(filter.catch(e, httpHost()) as any)).rejects.toBe(e);
  });
});
