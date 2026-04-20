import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ScopesGuard } from './scopes.guard';
import { SCOPES_KEY } from '../decorators/require-scopes';

function mockContext(userScopes: string[] | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: userScopes === undefined ? undefined : { scopes: userScopes } }),
    }),
  } as unknown as ExecutionContext;
}

function guardWithRequired(required: string[] | undefined): ScopesGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new ScopesGuard(reflector);
}

describe('ScopesGuard', () => {
  it('allows access when no scopes required', () => {
    const guard = guardWithRequired(undefined);
    expect(guard.canActivate(mockContext(['rooms:read']))).toBe(true);
  });

  it('allows access when required scopes are empty array', () => {
    const guard = guardWithRequired([]);
    expect(guard.canActivate(mockContext([]))).toBe(true);
  });

  it('allows access when user has all required scopes', () => {
    const guard = guardWithRequired(['rooms:read', 'rooms:write']);
    expect(guard.canActivate(mockContext(['rooms:read', 'rooms:write', 'extra']))).toBe(true);
  });

  it('throws ForbiddenException listing missing scopes', () => {
    const guard = guardWithRequired(['rooms:read', 'rooms:write']);
    expect(() => guard.canActivate(mockContext(['rooms:read']))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(mockContext(['rooms:read']))).toThrow(/rooms:write/);
  });

  it('throws when user has no scopes at all', () => {
    const guard = guardWithRequired(['rooms:read']);
    expect(() => guard.canActivate(mockContext(undefined))).toThrow(ForbiddenException);
  });

  it('exports a SCOPES_KEY symbol used by the decorator contract', () => {
    expect(SCOPES_KEY).toBeDefined();
  });
});
