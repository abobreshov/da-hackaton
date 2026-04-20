import { describe, it, expect } from 'vitest';
import type { Session } from './auth';
import { hasScope, hasAnyScope, hasAllScopes } from './auth';

const session = (scopes: string[] | undefined): Session | null =>
  ({ email: 'u@x', name: 'U', type: 'user', scopes: scopes as string[] }) as Session;

describe('auth scope helpers', () => {
  it('hasScope — true when scope present', () => {
    expect(hasScope(session(['rooms:read']), 'rooms:read')).toBe(true);
  });

  it('hasScope — false when scope missing', () => {
    expect(hasScope(session(['rooms:read']), 'rooms:write')).toBe(false);
  });

  it('hasScope — false on null/undefined session or scopes', () => {
    expect(hasScope(null, 'x')).toBe(false);
    expect(hasScope(undefined, 'x')).toBe(false);
    expect(hasScope(session(undefined), 'x')).toBe(false);
  });

  it('hasAnyScope — true when at least one matches', () => {
    expect(hasAnyScope(session(['a']), ['a', 'b'])).toBe(true);
    expect(hasAnyScope(session(['b']), ['a', 'b'])).toBe(true);
  });

  it('hasAnyScope — false when none match', () => {
    expect(hasAnyScope(session(['c']), ['a', 'b'])).toBe(false);
    expect(hasAnyScope(null, ['a'])).toBe(false);
  });

  it('hasAllScopes — true only when every scope matches', () => {
    expect(hasAllScopes(session(['a', 'b', 'c']), ['a', 'b'])).toBe(true);
    expect(hasAllScopes(session(['a']), ['a', 'b'])).toBe(false);
  });

  it('hasAllScopes — vacuously true for empty required list', () => {
    expect(hasAllScopes(session([]), [])).toBe(true);
  });
});
