import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ErrorCode } from '@app/contracts';
import { RpcErrorInterceptor } from './rpc-error.interceptor';

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
});
