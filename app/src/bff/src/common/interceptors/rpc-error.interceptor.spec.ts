import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ErrorCode } from '@app/contracts';
import { RpcErrorInterceptor, __test__ } from './rpc-error.interceptor';

function makeCtx(req: any = {}, res: any = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

function handlerThatThrows(err: unknown): CallHandler {
  return { handle: () => throwError(() => err) };
}

async function runAndCatch(ctx: ExecutionContext, handler: CallHandler): Promise<unknown> {
  const interceptor = new RpcErrorInterceptor();
  try {
    await firstValueFrom(interceptor.intercept(ctx, handler));
    throw new Error('expected interceptor stream to error');
  } catch (e) {
    return e;
  }
}

describe('RpcErrorInterceptor', () => {
  // NODE_ENV gates prod-message sanitization. Tests that rely on raw upstream
  // text being preserved must run with NODE_ENV !== 'production'; prod-mode
  // cases set it explicitly and restore after.
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });
  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it('passes through non-error values unchanged', async () => {
    const interceptor = new RpcErrorInterceptor();
    const handler: CallHandler = { handle: () => of({ ok: true }) };
    await expect(firstValueFrom(interceptor.intercept(makeCtx(), handler))).resolves.toEqual({
      ok: true,
    });
  });

  it.each([
    [400, ErrorCode.VALIDATION_FAILED],
    [401, ErrorCode.UNAUTHENTICATED],
    [403, ErrorCode.FORBIDDEN],
    [404, ErrorCode.NOT_FOUND],
    [409, ErrorCode.CONFLICT],
    [422, ErrorCode.VALIDATION_FAILED],
    [429, ErrorCode.RATE_LIMITED],
  ])('maps RpcException status %i to HttpException with code %s', async (status, expectedCode) => {
    const rpc = new RpcException({ status, message: `msg-${status}` });
    const caught = (await runAndCatch(makeCtx(), handlerThatThrows(rpc))) as HttpException;
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught.getStatus()).toBe(status);
    const body = caught.getResponse() as any;
    expect(body.code).toBe(expectedCode);
    expect(body.message).toBe(`msg-${status}`);
  });

  it('maps unknown status to UPSTREAM_UNAVAILABLE 502', async () => {
    const rpc = new RpcException({ status: 503, message: 'down' });
    const caught = (await runAndCatch(makeCtx(), handlerThatThrows(rpc))) as HttpException;
    expect(caught.getStatus()).toBe(503);
    const body = caught.getResponse() as any;
    expect(body.code).toBe(ErrorCode.UPSTREAM_UNAVAILABLE);
    expect(body.message).toBe('down');
  });

  it('falls back to default message when none given', async () => {
    const rpc = new RpcException({ status: 500 });
    const caught = (await runAndCatch(makeCtx(), handlerThatThrows(rpc))) as HttpException;
    expect(caught.getStatus()).toBe(500);
    const body = caught.getResponse() as any;
    expect(body.code).toBe(ErrorCode.UPSTREAM_UNAVAILABLE);
    expect(body.message).toBe('Upstream service error');
  });

  it('preserves explicit code from RpcException payload', async () => {
    const rpc = new RpcException({ code: ErrorCode.CSRF_INVALID, message: 'bad csrf' });
    const caught = (await runAndCatch(makeCtx(), handlerThatThrows(rpc))) as HttpException;
    expect(caught.getStatus()).toBe(403);
    const body = caught.getResponse() as any;
    expect(body.code).toBe(ErrorCode.CSRF_INVALID);
    expect(body.message).toBe('bad csrf');
  });

  it('attaches requestId from x-request-id header and sets response header', async () => {
    const headerFn = jest.fn();
    const ctx = makeCtx(
      { headers: { 'x-request-id': 'req-123' } },
      { header: headerFn },
    );
    const rpc = new RpcException({ status: 401, message: 'nope' });
    const caught = (await runAndCatch(ctx, handlerThatThrows(rpc))) as HttpException;
    const body = caught.getResponse() as any;
    expect(body.requestId).toBe('req-123');
    expect(headerFn).toHaveBeenCalledWith('X-Request-Id', 'req-123');
  });

  it('preserves details and retryAfterMs when provided', async () => {
    const rpc = new RpcException({
      status: 429,
      message: 'slow down',
      retryAfterMs: 5000,
      details: { bucket: 'login' },
    });
    const caught = (await runAndCatch(makeCtx(), handlerThatThrows(rpc))) as HttpException;
    const body = caught.getResponse() as any;
    expect(body.retryAfterMs).toBe(5000);
    expect(body.details).toEqual({ bucket: 'login' });
    expect(body.code).toBe(ErrorCode.RATE_LIMITED);
  });

  it('rethrows non-RpcException errors untouched', async () => {
    const err = new Error('boom');
    const caught = await runAndCatch(makeCtx(), handlerThatThrows(err));
    expect(caught).toBe(err);
  });

  describe('production message sanitization', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it.each([
      [401, ErrorCode.UNAUTHENTICATED],
      [403, ErrorCode.FORBIDDEN],
      [404, ErrorCode.NOT_FOUND],
      [409, ErrorCode.CONFLICT],
      [400, ErrorCode.VALIDATION_FAILED],
      [429, ErrorCode.RATE_LIMITED],
    ])('replaces raw upstream message with SAFE_MESSAGES[%s] → %s', async (status, code) => {
      const rpc = new RpcException({
        status,
        message: 'leaky internal detail: users.email UNIQUE violated at pg@10.0.0.5',
      });
      const caught = (await runAndCatch(makeCtx(), handlerThatThrows(rpc))) as HttpException;
      const body = caught.getResponse() as any;
      expect(body.code).toBe(code);
      expect(body.message).toBe(__test__.SAFE_MESSAGES[code]);
      expect(body.message).not.toContain('leaky internal detail');
    });

    it('unknown codes fall back to GENERIC_SAFE_MESSAGE', async () => {
      const rpc = new RpcException({ code: 'TOTALLY_MADE_UP' as any, message: 'secret leak' });
      const caught = (await runAndCatch(makeCtx(), handlerThatThrows(rpc))) as HttpException;
      const body = caught.getResponse() as any;
      expect(body.message).toBe(__test__.GENERIC_SAFE_MESSAGE);
      expect(body.message).toBe('Request failed');
    });

    it('preserves structured fields (details, retryAfterMs, requestId) while sanitizing message', async () => {
      const rpc = new RpcException({
        status: 429,
        message: 'bucket=login ip=10.0.0.5 remaining=0',
        retryAfterMs: 9000,
        details: { bucket: 'login' },
      });
      const ctx = makeCtx({ headers: { 'x-request-id': 'rid-prod' } }, { header: jest.fn() });
      const caught = (await runAndCatch(ctx, handlerThatThrows(rpc))) as HttpException;
      const body = caught.getResponse() as any;
      expect(body.message).toBe(__test__.SAFE_MESSAGES[ErrorCode.RATE_LIMITED]);
      expect(body.details).toEqual({ bucket: 'login' });
      expect(body.retryAfterMs).toBe(9000);
      expect(body.requestId).toBe('rid-prod');
    });
  });

  describe('development message behaviour', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('preserves the raw upstream message verbatim (debuggability)', async () => {
      const rpc = new RpcException({ status: 500, message: 'pg: duplicate key x=y' });
      const caught = (await runAndCatch(makeCtx(), handlerThatThrows(rpc))) as HttpException;
      const body = caught.getResponse() as any;
      expect(body.message).toBe('pg: duplicate key x=y');
    });
  });
});
