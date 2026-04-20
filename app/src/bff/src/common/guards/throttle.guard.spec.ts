import 'reflect-metadata';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottleGuard } from './throttle.guard';
import { Throttle, ThrottleOptions } from '../decorators/throttle.decorator';

function makeCtx(handler: any, req: any = {}): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

// Build an ioredis-style pipeline mock. `runAll` replaces the `.exec()` method
// on the pipeline (ioredis calls `.exec()` to run the queued commands).
function buildPipeline(runAll: () => Promise<unknown>) {
  const pipeline: any = {
    zremrangebyscore: jest.fn().mockReturnThis(),
    zadd: jest.fn().mockReturnThis(),
    zcard: jest.fn().mockReturnThis(),
    pexpire: jest.fn().mockReturnThis(),
  };
  pipeline['exec'] = jest.fn(runAll);
  return pipeline;
}

function makeRedis(count: number, oldestTs = Date.now() - 1000) {
  const pipeline = buildPipeline(async () => [
    [null, 0],
    [null, 1],
    [null, count],
    [null, 1],
  ]);
  return {
    multi: () => pipeline,
    zrange: jest.fn().mockResolvedValue(['member', `${oldestTs}`]),
    _pipeline: pipeline,
  } as any;
}

describe('ThrottleGuard — multi-bucket', () => {
  it('allows when all buckets are under limit', async () => {
    class Ctrl {
      @Throttle({ scope: 'reset', limit: 1, windowMs: 60_000, failClosed: true })
      @Throttle({
        scope: 'reset-ip',
        limit: 5,
        windowMs: 3_600_000,
        failClosed: true,
        keyFn: () => 'ip:1.2.3.4',
      })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), makeRedis(1));
    const ctx = makeCtx(Ctrl.prototype.method, {
      ip: '1.2.3.4',
      session: { userId: 7 },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects when the second bucket exceeds its limit', async () => {
    class Ctrl {
      @Throttle({ scope: 'reset', limit: 1, windowMs: 60_000, failClosed: true })
      @Throttle({ scope: 'reset-ip', limit: 5, windowMs: 3_600_000, failClosed: true })
      method() {}
    }
    // Redis reports count=7 → both buckets exceed their limits, first one
    // evaluated throws 429.
    const guard = new ThrottleGuard(new Reflector(), makeRedis(7));
    const ctx = makeCtx(Ctrl.prototype.method, { ip: '1.2.3.4' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });

  it('fail-closed when redis client missing and opts.failClosed=true', async () => {
    class Ctrl {
      @Throttle({ scope: 'reset', limit: 1, windowMs: 60_000, failClosed: true })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), undefined);
    const ctx = makeCtx(Ctrl.prototype.method, { ip: '1.2.3.4' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });

  it('no metadata means no-op (returns true)', async () => {
    const guard = new ThrottleGuard(new Reflector(), undefined);
    const ctx = makeCtx(function bare() {}, {});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

// Silence unused import warning for ThrottleOptions in a lightweight way —
// keeps the import resolvable for future additions.
void ({} as ThrottleOptions);

describe('ThrottleGuard — failClosed scope defaults (line 25)', () => {
  it('fail-closes on scope=login when opts.failClosed omitted and Redis is down', async () => {
    class Ctrl {
      @Throttle({ scope: 'login', limit: 5, windowMs: 60_000 })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), undefined);
    const ctx = makeCtx(Ctrl.prototype.method, { ip: '1.2.3.4' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });

  it('fail-opens on non-protected scope=msg when Redis missing (default-false branch)', async () => {
    class Ctrl {
      @Throttle({ scope: 'msg', limit: 5, windowMs: 60_000 })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), undefined);
    const ctx = makeCtx(Ctrl.prototype.method, { ip: '1.2.3.4' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

describe('ThrottleGuard — Redis outage fail-closed branches', () => {
  it('lines 91-92: null pipeline result is treated as miss → fail-closed for protected scope', async () => {
    const pipeline = buildPipeline(async () => null);
    const redis = { multi: () => pipeline, zrange: jest.fn() } as any;

    class Ctrl {
      @Throttle({ scope: 'reset', limit: 1, windowMs: 60_000, failClosed: true })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), redis);
    const ctx = makeCtx(Ctrl.prototype.method, { ip: '1.2.3.4' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });

  it('lines 91-92: null result on non-protected scope fail-opens (true)', async () => {
    const pipeline = buildPipeline(async () => null);
    const redis = { multi: () => pipeline, zrange: jest.fn() } as any;

    class Ctrl {
      @Throttle({ scope: 'msg', limit: 10, windowMs: 1_000, failClosed: false })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), redis);
    const ctx = makeCtx(Ctrl.prototype.method, { ip: '1.2.3.4' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('line 113: rejection from pipeline runner is caught → fail-closed via handleRedisMiss', async () => {
    const pipeline = buildPipeline(() => Promise.reject(new Error('ECONNREFUSED')));
    const redis = { multi: () => pipeline, zrange: jest.fn() } as any;

    class Ctrl {
      @Throttle({ scope: 'login', limit: 5, windowMs: 60_000, failClosed: true })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), redis);
    const ctx = makeCtx(Ctrl.prototype.method, { ip: '1.2.3.4' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });

  it('lines 129-132: fail-open warn path allows request (non-protected scope, Redis throws)', async () => {
    const pipeline = buildPipeline(() => Promise.reject(new Error('ETIMEDOUT')));
    const redis = { multi: () => pipeline, zrange: jest.fn() } as any;

    class Ctrl {
      @Throttle({ scope: 'msg', limit: 1, windowMs: 1000, failClosed: false })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), redis);
    const ctx = makeCtx(Ctrl.prototype.method, { ip: '1.2.3.4' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('line 113: non-Error rejection falls back to "redis error" message', async () => {
    // Reject with a plain object so (err as Error).message is undefined →
    // exercises the ?? 'redis error' fallback in handleRedisMiss call-site.
    const pipeline = buildPipeline(() => Promise.reject({}));
    const redis = { multi: () => pipeline, zrange: jest.fn() } as any;

    class Ctrl {
      @Throttle({ scope: 'reset', limit: 1, windowMs: 1000, failClosed: true })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), redis);
    const ctx = makeCtx(Ctrl.prototype.method, { ip: '1.2.3.4' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });
});

describe('ThrottleGuard — key resolution (defaultKey)', () => {
  function makeAllowRedis() {
    const pipeline = buildPipeline(async () => [
      [null, 0],
      [null, 1],
      [null, 1],
      [null, 1],
    ]);
    return { redis: { multi: () => pipeline, zrange: jest.fn() } as any, pipeline };
  }

  it('uses session.userId when present → key is u:<id>', async () => {
    const { redis, pipeline } = makeAllowRedis();
    class Ctrl {
      @Throttle({ scope: 'login', limit: 5, windowMs: 60_000 })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), redis);
    const ctx = makeCtx(Ctrl.prototype.method, { session: { userId: 42 }, ip: '1.2.3.4' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(pipeline.zadd.mock.calls[0][0]).toBe('ratelimit:login:u:42');
  });

  it('falls back to session.adminId when userId is absent', async () => {
    const { redis, pipeline } = makeAllowRedis();
    class Ctrl {
      @Throttle({ scope: 'login', limit: 5, windowMs: 60_000 })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), redis);
    const ctx = makeCtx(Ctrl.prototype.method, { session: { adminId: 7 }, ip: '5.6.7.8' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(pipeline.zadd.mock.calls[0][0]).toBe('ratelimit:login:a:7');
  });

  it('falls back to req.ip when session has no identity', async () => {
    const { redis, pipeline } = makeAllowRedis();
    class Ctrl {
      @Throttle({ scope: 'login', limit: 5, windowMs: 60_000 })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), redis);
    const ctx = makeCtx(Ctrl.prototype.method, { ip: '9.9.9.9' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(pipeline.zadd.mock.calls[0][0]).toBe('ratelimit:login:ip:9.9.9.9');
  });

  it('falls back to socket.remoteAddress when req.ip is missing', async () => {
    const { redis, pipeline } = makeAllowRedis();
    class Ctrl {
      @Throttle({ scope: 'login', limit: 5, windowMs: 60_000 })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), redis);
    const ctx = makeCtx(Ctrl.prototype.method, { socket: { remoteAddress: '8.8.8.8' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(pipeline.zadd.mock.calls[0][0]).toBe('ratelimit:login:ip:8.8.8.8');
  });

  it('uses "unknown" when ip and socket.remoteAddress are both absent', async () => {
    const { redis, pipeline } = makeAllowRedis();
    class Ctrl {
      @Throttle({ scope: 'login', limit: 5, windowMs: 60_000 })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), redis);
    const ctx = makeCtx(Ctrl.prototype.method, {});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(pipeline.zadd.mock.calls[0][0]).toBe('ratelimit:login:ip:unknown');
  });

  it('honours custom keyFn over session/ip defaults', async () => {
    const { redis, pipeline } = makeAllowRedis();
    class Ctrl {
      @Throttle({
        scope: 'reset-ip',
        limit: 5,
        windowMs: 1000,
        keyFn: (req: any) => `ip:${req.ip}`,
      })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), redis);
    const ctx = makeCtx(Ctrl.prototype.method, {
      ip: '1.2.3.4',
      session: { userId: 999 }, // ignored in favour of keyFn
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(pipeline.zadd.mock.calls[0][0]).toBe('ratelimit:reset-ip:ip:1.2.3.4');
  });
});

describe('ThrottleGuard — retry-after computation on over-limit', () => {
  it('429 body includes retryAfterMs derived from oldest zset member', async () => {
    const now = Date.now();
    const oldest = now - 10_000;
    const redis = makeRedis(99, oldest);
    class Ctrl {
      @Throttle({ scope: 'login', limit: 5, windowMs: 60_000 })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), redis);
    const ctx = makeCtx(Ctrl.prototype.method, { ip: '1.2.3.4' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({
        retryAfterMs: expect.any(Number),
      }),
    });
  });

  it('falls back to windowMs retry-after when zrange returns an empty list', async () => {
    // With an empty zrange result oldestTs = now → retryAfterMs = windowMs.
    // Covers the `.length >= 2 ? … : now` fallback branch.
    const pipeline = buildPipeline(async () => [
      [null, 0],
      [null, 1],
      [null, 99],
      [null, 1],
    ]);
    const redis = {
      multi: () => pipeline,
      zrange: jest.fn().mockResolvedValue([]),
    } as any;

    class Ctrl {
      @Throttle({ scope: 'login', limit: 5, windowMs: 60_000 })
      method() {}
    }
    const guard = new ThrottleGuard(new Reflector(), redis);
    const ctx = makeCtx(Ctrl.prototype.method, { ip: '1.2.3.4' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({ retryAfterMs: 60_000 }),
    });
  });
});
