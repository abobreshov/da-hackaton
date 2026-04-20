import 'reflect-metadata';
import { UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { CurrentUserId, __currentUserIdFactory } from './current-user.decorator';

/**
 * Unit tests for the @CurrentUserId() param decorator.
 *
 * We test the underlying factory function directly — NestJS's
 * `createParamDecorator` wraps it verbatim, and invoking the decorator via
 * reflection requires spinning up a real request pipeline. Exporting the
 * factory explicitly for tests is the conventional workaround.
 */
describe('@CurrentUserId() factory', () => {
  function makeCtx(req: any): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
  }

  it('returns the numeric id parsed from the session sub (u:42 → 42)', () => {
    const ctx = makeCtx({ session: { sub: 'u:42', type: 'user' } });
    expect(__currentUserIdFactory(undefined, ctx)).toBe(42);
  });

  it('throws UnauthorizedException when session is missing', () => {
    const ctx = makeCtx({});
    expect(() => __currentUserIdFactory(undefined, ctx)).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when session.sub is missing', () => {
    const ctx = makeCtx({ session: { type: 'user' } });
    expect(() => __currentUserIdFactory(undefined, ctx)).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when session.type is not user (admin session)', () => {
    const ctx = makeCtx({ session: { sub: 'a:1', type: 'admin' } });
    expect(() => __currentUserIdFactory(undefined, ctx)).toThrow(
      UnauthorizedException,
    );
  });

  it('throws on malformed sub (no prefix)', () => {
    const ctx = makeCtx({ session: { sub: '42', type: 'user' } });
    expect(() => __currentUserIdFactory(undefined, ctx)).toThrow();
  });

  it('returns a plain number, not a string', () => {
    const ctx = makeCtx({ session: { sub: 'u:7', type: 'user' } });
    const id = __currentUserIdFactory(undefined, ctx);
    expect(typeof id).toBe('number');
    expect(id).toBe(7);
  });

  it('exposes CurrentUserId as a decorator function', () => {
    expect(typeof CurrentUserId).toBe('function');
    // Decorators built via createParamDecorator return a function that, when
    // called with no args, yields a ParameterDecorator.
    const paramDecorator = CurrentUserId();
    expect(typeof paramDecorator).toBe('function');
  });
});
