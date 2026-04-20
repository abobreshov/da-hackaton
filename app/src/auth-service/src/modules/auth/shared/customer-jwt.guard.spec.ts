process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET ?? 'x'.repeat(48);
process.env.JWT_CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET ?? 'y'.repeat(48);
process.env.SYSTEM_KEY = process.env.SYSTEM_KEY ?? 'z'.repeat(48);

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { CustomerJwtGuard } from './customer-jwt.guard';
import type { JwtService } from './jwt.service';

function httpCtx(request: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CustomerJwtGuard', () => {
  let guard: CustomerJwtGuard;
  let jwt: jest.Mocked<JwtService>;

  beforeEach(() => {
    jwt = {
      verifyUser: jest.fn(),
      verifyAdmin: jest.fn(),
      signUser: jest.fn(),
      signAdmin: jest.fn(),
    } as any;
    guard = new CustomerJwtGuard(jwt);
  });

  it('short-circuits to true for non-http contexts (TCP / WS)', () => {
    const ctx = { getType: () => 'rpc' } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws Unauthorized when Authorization header is missing', () => {
    const ctx = httpCtx({ headers: {} });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow(/Missing bearer token/);
  });

  it('throws Unauthorized when Authorization does not start with "Bearer "', () => {
    const ctx = httpCtx({ headers: { authorization: 'Basic abc' } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws Unauthorized when JwtService.verifyUser throws', () => {
    jwt.verifyUser.mockImplementation(() => {
      throw new Error('bad sig');
    });
    const ctx = httpCtx({ headers: { authorization: 'Bearer badtoken' } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx)).toThrow(/Invalid or expired token/);
  });

  it('attaches the decoded payload to request.user and returns true on success', () => {
    jwt.verifyUser.mockReturnValue({
      sub: 'u:1',
      type: 'user',
      email: 'u@x.com',
      scopes: ['s'],
    } as never);
    const req: Record<string, unknown> = {
      headers: { authorization: 'Bearer tok' },
    };
    const ctx = httpCtx(req);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.user).toEqual({
      sub: 'u:1',
      type: 'user',
      email: 'u@x.com',
      scopes: ['s'],
    });
    expect(jwt.verifyUser).toHaveBeenCalledWith('tok');
  });

  it('trims whitespace after "Bearer "', () => {
    jwt.verifyUser.mockReturnValue({
      sub: 'u:1',
      type: 'user',
      email: 'u@x.com',
      scopes: [],
    } as never);
    const req: Record<string, unknown> = {
      headers: { authorization: 'Bearer    tok   ' },
    };
    expect(guard.canActivate(httpCtx(req))).toBe(true);
    expect(jwt.verifyUser).toHaveBeenCalledWith('tok');
  });
});
