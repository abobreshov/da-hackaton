import {
  BadGatewayException,
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { firstValueFrom, of, throwError } from 'rxjs';
import { RpcErrorInterceptor } from './rpc-error.interceptor';

const ctx = {} as ExecutionContext;

function handlerThatThrows(err: unknown): CallHandler {
  return { handle: () => throwError(() => err) };
}

async function runAndCatch(handler: CallHandler): Promise<unknown> {
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
    await expect(firstValueFrom(interceptor.intercept(ctx, handler))).resolves.toEqual({
      ok: true,
    });
  });

  it.each([
    [400, BadRequestException],
    [401, UnauthorizedException],
    [403, ForbiddenException],
    [404, NotFoundException],
    [409, ConflictException],
    [422, UnprocessableEntityException],
  ])('maps RpcException status %i to matching HttpException', async (status, expected) => {
    const rpc = new RpcException({ status, message: `msg-${status}` });
    const caught = await runAndCatch(handlerThatThrows(rpc));
    expect(caught).toBeInstanceOf(expected);
    expect((caught as Error).message).toBe(`msg-${status}`);
  });

  it('maps unknown status to BadGatewayException', async () => {
    const rpc = new RpcException({ status: 503, message: 'down' });
    const caught = await runAndCatch(handlerThatThrows(rpc));
    expect(caught).toBeInstanceOf(BadGatewayException);
    expect((caught as Error).message).toBe('down');
  });

  it('falls back to default message when none given', async () => {
    const rpc = new RpcException({ status: 500 });
    const caught = await runAndCatch(handlerThatThrows(rpc));
    expect(caught).toBeInstanceOf(BadGatewayException);
    expect((caught as Error).message).toBe('Upstream service error');
  });

  it('reads statusCode when status is absent', async () => {
    const rpc = new RpcException({ statusCode: 404, message: 'nope' } as any);
    const caught = await runAndCatch(handlerThatThrows(rpc));
    expect(caught).toBeInstanceOf(NotFoundException);
  });

  it('rethrows non-RpcException errors untouched', async () => {
    const err = new Error('boom');
    const caught = await runAndCatch(handlerThatThrows(err));
    expect(caught).toBe(err);
  });
});
