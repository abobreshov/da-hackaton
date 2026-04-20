/**
 * Characterization tests for JwtGuard — HTTP route guard that validates a
 * Bearer token by calling auth-service over TCP (pattern 'auth.customer.validateToken').
 *
 * The guard must:
 *  - 401 when Authorization header is missing
 *  - 401 when Authorization does not start with 'Bearer '
 *  - attach the user to req.user on success (and return true)
 *  - wrap _any_ TCP failure as UnauthorizedException (401)
 *  - wrap the outbound payload via `withSys({ token })`
 */

jest.mock('../../config/environment', () => ({
  env: {
    SYSTEM_KEY: 'test-system-key-32-char-value-abcde',
    TLS_ENABLED: false,
    AUTH_TCP_HOST: 'localhost',
    AUTH_TCP_PORT: 4003,
  },
}));

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { JwtGuard } from './jwt.guard';

function mockHttpContext(headers: Record<string, unknown>): { ctx: ExecutionContext; req: any } {
  const req: any = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('JwtGuard', () => {
  let auth: { send: jest.Mock };
  let guard: JwtGuard;

  beforeEach(() => {
    auth = { send: jest.fn() };
    guard = new JwtGuard(auth as any);
  });

  it('throws UnauthorizedException when Authorization header is missing', async () => {
    const { ctx } = mockHttpContext({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.send).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when Authorization header is not Bearer', async () => {
    const { ctx } = mockHttpContext({ authorization: 'Basic abc' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.send).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException for empty Bearer token', async () => {
    // "Bearer " without token still starts with "Bearer " and goes to TCP.
    // Auth-service will fail validation -> guard catches -> 401.
    auth.send.mockReturnValue(throwError(() => new Error('invalid token')));
    const { ctx } = mockHttpContext({ authorization: 'Bearer ' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches validated user to req.user and returns true on success', async () => {
    const user = { id: 42, email: 'alice@example.com' };
    auth.send.mockReturnValue(of(user));
    const { ctx, req } = mockHttpContext({ authorization: 'Bearer token-abc' });

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(req.user).toEqual(user);
  });

  it('forwards the correct pattern + withSys-wrapped payload over TCP', async () => {
    auth.send.mockReturnValue(of({ id: 1 }));
    const { ctx } = mockHttpContext({ authorization: 'Bearer raw-jwt' });
    await guard.canActivate(ctx);

    expect(auth.send).toHaveBeenCalledTimes(1);
    const [pattern, payload] = auth.send.mock.calls[0];
    expect(pattern).toEqual({ cmd: 'auth.customer.validateToken' });
    expect(payload).toMatchObject({
      token: 'raw-jwt',
      _sys: 'test-system-key-32-char-value-abcde',
    });
  });

  it('converts any TCP failure to UnauthorizedException', async () => {
    auth.send.mockReturnValue(throwError(() => new Error('remote exploded')));
    const { ctx } = mockHttpContext({ authorization: 'Bearer good-format-bad-token' });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('converts RpcException-like error to 401 (no leak of remote status)', async () => {
    auth.send.mockReturnValue(
      throwError(() => ({ status: 403, message: 'banned' })),
    );
    const { ctx } = mockHttpContext({ authorization: 'Bearer x' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
