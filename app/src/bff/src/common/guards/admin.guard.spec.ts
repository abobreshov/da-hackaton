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
    const ctx = httpCtx({ session: { sub: 'a:1', type: 'admin' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects user sessions with 403', () => {
    const ctx = httpCtx({ session: { sub: 'u:5', type: 'user' } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects requests without a session (401)', () => {
    const ctx = httpCtx({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('does not trust an `a:` sub prefix without a matching type: admin', () => {
    // Defence in depth: a session blob with an `a:` sub but type !== 'admin'
    // must not be treated as admin. The cookie signer controls `type`.
    const ctx = httpCtx({ session: { sub: 'a:99', type: 'user' } });
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
