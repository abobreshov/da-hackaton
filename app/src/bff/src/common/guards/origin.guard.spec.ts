/**
 * The guard imports `env` at module load, so we stub the config module
 * before importing the guard to lock ALLOWED_ORIGINS to a known value.
 */
jest.mock('../../config/environment', () => ({
  env: { ALLOWED_ORIGINS: 'http://localhost:3007,https://app.example.com' },
}));

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OriginGuard } from './origin.guard';

function mockContext(
  method: string,
  headers: Record<string, string | undefined>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, url: '/api/v1/test', headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('OriginGuard', () => {
  const guard = new OriginGuard();

  it.each(['GET', 'HEAD', 'OPTIONS'])('allows safe method %s without Origin', (method) => {
    expect(guard.canActivate(mockContext(method, {}))).toBe(true);
  });

  it('allows mutation when Origin is in the allowlist', () => {
    expect(guard.canActivate(mockContext('POST', { origin: 'http://localhost:3007' }))).toBe(true);
  });

  it('blocks mutation with Origin outside the allowlist', () => {
    expect(() =>
      guard.canActivate(mockContext('POST', { origin: 'https://evil.example.com' })),
    ).toThrow(ForbiddenException);
  });

  it('blocks mutation when Origin and Referer are both missing', () => {
    expect(() => guard.canActivate(mockContext('POST', {}))).toThrow(ForbiddenException);
  });

  it('falls back to Referer when Origin is missing and validates its origin', () => {
    expect(
      guard.canActivate(mockContext('PUT', { referer: 'http://localhost:3007/app/users' })),
    ).toBe(true);
    expect(() =>
      guard.canActivate(mockContext('PUT', { referer: 'https://evil.example.com/attack' })),
    ).toThrow(ForbiddenException);
  });

  it('rejects malformed Referer values', () => {
    expect(() => guard.canActivate(mockContext('DELETE', { referer: 'not-a-url' }))).toThrow(
      ForbiddenException,
    );
  });

  it('is case-insensitive on HTTP method', () => {
    expect(guard.canActivate(mockContext('get', {}))).toBe(true);
    expect(guard.canActivate(mockContext('post', { origin: 'http://localhost:3007' }))).toBe(true);
  });
});
