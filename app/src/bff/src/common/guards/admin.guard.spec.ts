import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

function httpCtx(req: any): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  it('allows requests with an admin session', () => {
    const ctx = httpCtx({ session: { adminId: 1, type: 'admin' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects user sessions with 403', () => {
    const ctx = httpCtx({ session: { userId: 5, type: 'user' } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects requests without a session (401)', () => {
    const ctx = httpCtx({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('does not trust an adminId key without a matching type: admin', () => {
    // Defence in depth: a session blob that happens to have adminId but
    // type !== 'admin' must not be treated as admin.
    const ctx = httpCtx({ session: { adminId: 99, type: 'user' } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('short-circuits non-http contexts (e.g. RPC) to true', () => {
    const ctx = {
      getType: () => 'rpc',
      switchToHttp: () => {
        throw new Error('should not reach http context');
      },
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
