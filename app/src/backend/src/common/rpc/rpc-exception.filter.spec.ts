/**
 * Characterization tests for `RpcExceptionFilter` — the global microservice
 * filter that translates domain `HttpException`s thrown from service methods
 * into `RpcException` envelopes consumable by the BFF's `RpcErrorInterceptor`.
 *
 * Mapping contract (replaces the per-module `toRpc` helpers):
 *  - HttpException            -> RpcException({ status, message, code?, details?, retryAfterMs? })
 *  - RpcException             -> rethrow (already wrapped upstream, e.g. SystemKeyRpcGuard)
 *  - Error                    -> RpcException({ status: 500, message, code: 'UPSTREAM_UNAVAILABLE' })
 *  - anything else (string..) -> RpcException({ status: 500, message: 'Internal error', code: 'UPSTREAM_UNAVAILABLE' })
 *
 * The filter is a no-op on HTTP contexts: the service also runs Fastify HTTP
 * routes for `/health`, and those must keep surfacing HttpException normally
 * instead of being rewrapped as RpcException.
 */

import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { firstValueFrom, of, throwError } from 'rxjs';
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

async function expectRpcReject<T = unknown>(obs$: unknown): Promise<RpcException & { getError: () => T }> {
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

describe('RpcExceptionFilter', () => {
  let filter: RpcExceptionFilter;

  beforeEach(() => {
    filter = new RpcExceptionFilter();
  });

  // ---------------------------------------------------------------------------
  // HttpException mapping — one test per status code we actually emit.
  // ---------------------------------------------------------------------------

  it('maps BadRequestException (400) to RpcException with status+message', async () => {
    const e = await expectRpcReject<{ status: number; message: string }>(
      filter.catch(new BadRequestException('bad input'), rpcHost()),
    );
    expect(e.getError()).toMatchObject({ status: 400, message: 'bad input' });
  });

  it('maps UnauthorizedException (401) preserving message', async () => {
    const e = await expectRpcReject<{ status: number; message: string }>(
      filter.catch(new UnauthorizedException('no session'), rpcHost()),
    );
    expect(e.getError()).toMatchObject({ status: 401, message: 'no session' });
  });

  it('maps ForbiddenException (403) preserving message', async () => {
    const e = await expectRpcReject<{ status: number; message: string }>(
      filter.catch(new ForbiddenException('owner required'), rpcHost()),
    );
    expect(e.getError()).toMatchObject({ status: 403, message: 'owner required' });
  });

  it('maps NotFoundException (404) preserving message', async () => {
    const e = await expectRpcReject<{ status: number; message: string }>(
      filter.catch(new NotFoundException('room gone'), rpcHost()),
    );
    expect(e.getError()).toMatchObject({ status: 404, message: 'room gone' });
  });

  it('maps ConflictException (409) preserving message', async () => {
    const e = await expectRpcReject<{ status: number; message: string }>(
      filter.catch(new ConflictException('dup'), rpcHost()),
    );
    expect(e.getError()).toMatchObject({ status: 409, message: 'dup' });
  });

  it('maps 429 Too Many Requests preserving message', async () => {
    const e = await expectRpcReject<{ status: number; message: string }>(
      filter.catch(new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS), rpcHost()),
    );
    expect(e.getError()).toMatchObject({ status: 429, message: 'slow down' });
  });

  // ---------------------------------------------------------------------------
  // HttpException payload shapes — object body (with / without `message`).
  // ---------------------------------------------------------------------------

  it('preserves array `message` (class-validator style) from object response', async () => {
    const e = await expectRpcReject<{ status: number; message: string[] }>(
      filter.catch(new BadRequestException(['name must be string', 'email invalid']), rpcHost()),
    );
    expect(e.getError()).toMatchObject({
      status: 400,
      message: ['name must be string', 'email invalid'],
    });
  });

  it('falls back to err.message when object response lacks a `message` field', async () => {
    const e = await expectRpcReject<{ status: number; message: string }>(
      filter.catch(new HttpException({ foo: 'bar' }, 409), rpcHost()),
    );
    // Nest default err.message includes status text; we just need it to be non-empty.
    expect(e.getError()).toMatchObject({ status: 409 });
    expect((e.getError() as { message: string }).message).toBeTruthy();
  });

  it('propagates `code`, `details`, and `retryAfterMs` from an object response', async () => {
    const body = {
      message: 'rate limited',
      code: 'RATE_LIMITED',
      retryAfterMs: 2500,
      details: { scope: 'login' },
    };
    const e = await expectRpcReject<Record<string, unknown>>(
      filter.catch(new HttpException(body, HttpStatus.TOO_MANY_REQUESTS), rpcHost()),
    );
    expect(e.getError()).toMatchObject({
      status: 429,
      message: 'rate limited',
      code: 'RATE_LIMITED',
      retryAfterMs: 2500,
      details: { scope: 'login' },
    });
  });

  // ---------------------------------------------------------------------------
  // RpcException passthrough — SystemKeyRpcGuard already raises RpcException,
  // we must not re-wrap it.
  // ---------------------------------------------------------------------------

  it('rethrows RpcException unchanged (already in the wire envelope)', async () => {
    const original = new RpcException({ status: 401, message: 'bad _sys' });
    const rethrown = await expectRpcReject(filter.catch(original, rpcHost()));
    expect(rethrown).toBe(original);
  });

  // ---------------------------------------------------------------------------
  // Plain Error / unknown — map to 500 with UPSTREAM_UNAVAILABLE.
  // ---------------------------------------------------------------------------

  it('wraps plain Error as RpcException(500, UPSTREAM_UNAVAILABLE)', async () => {
    const e = await expectRpcReject<{ status: number; message: string; code: string }>(
      filter.catch(new Error('boom'), rpcHost()),
    );
    expect(e.getError()).toMatchObject({
      status: 500,
      message: 'boom',
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('wraps string throwable as RpcException(500) with generic message', async () => {
    const e = await expectRpcReject<{ status: number; message: string; code: string }>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filter.catch('string-value' as any, rpcHost()),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = await expectRpcReject(filter.catch(undefined as any, rpcHost()));
    expect(b.getError()).toMatchObject({ status: 500, message: 'Internal error' });
  });

  // ---------------------------------------------------------------------------
  // HTTP context — the filter must not touch HttpExceptions raised from Fastify
  // routes (e.g. /health). Those need the default HTTP exception filter.
  // ---------------------------------------------------------------------------

  it('rethrows HttpException unchanged when host.getType() is "http"', async () => {
    const e = new BadRequestException('browser-facing');
    await expect(firstValueFrom(filter.catch(e, httpHost()) as any)).rejects.toBe(e);
  });

  it('rethrows plain Error unchanged when host.getType() is "http"', async () => {
    const e = new Error('boom');
    await expect(firstValueFrom(filter.catch(e, httpHost()) as any)).rejects.toBe(e);
  });

  // ---------------------------------------------------------------------------
  // Return shape sanity — catch() must return an Observable that errors,
  // matching the NestJS RpcExceptionFilter contract.
  // ---------------------------------------------------------------------------

  it('returns an Observable<never> that errors (not a thrown value)', async () => {
    const obs$ = filter.catch(new BadRequestException('x'), rpcHost());
    // Must have subscribe + a sane failure path.
    expect(typeof (obs$ as any).subscribe).toBe('function');
    await expect(firstValueFrom(obs$ as any)).rejects.toBeInstanceOf(RpcException);
    // sanity: of() and throwError() from the same rxjs we use
    expect(of(1)).toBeDefined();
    expect(throwError(() => new Error('n'))).toBeDefined();
  });
});
