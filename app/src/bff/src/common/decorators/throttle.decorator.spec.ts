import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { Throttle, THROTTLE_METADATA_KEY, ThrottleOptions } from './throttle.decorator';

describe('Throttle decorator', () => {
  it('stores a single opts as an array of one bucket', () => {
    class X {
      @Throttle({ scope: 'reset', limit: 1, windowMs: 60_000, failClosed: true })
      method() {}
    }
    const meta = new Reflector().get<ThrottleOptions[]>(THROTTLE_METADATA_KEY, X.prototype.method);
    expect(Array.isArray(meta)).toBe(true);
    expect(meta).toHaveLength(1);
    expect(meta[0].scope).toBe('reset');
  });

  it('stacks multiple decorators into an array preserving both buckets', () => {
    class X {
      @Throttle({ scope: 'reset', limit: 1, windowMs: 60_000, failClosed: true })
      @Throttle({ scope: 'reset-ip', limit: 5, windowMs: 3_600_000, failClosed: true })
      method() {}
    }
    const meta = new Reflector().get<ThrottleOptions[]>(THROTTLE_METADATA_KEY, X.prototype.method);
    expect(Array.isArray(meta)).toBe(true);
    expect(meta.map((m) => m.scope).sort()).toEqual(['reset', 'reset-ip']);
  });
});
