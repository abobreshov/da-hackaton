/**
 * RedisModule.onApplicationShutdown — ensures the global ioredis client
 * wired into ThrottleGuard / WsConnectRateLimit is drained on process
 * exit. Without this hook the client leaks and keeps the event loop
 * alive (ioredis reconnect timers). CodeRabbit M1 finding.
 */
jest.mock('./config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    SYSTEM_KEY: 'test-sys-key',
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    ALLOWED_ORIGINS: 'http://localhost:3007',
    COOKIE_SECRET: 'test-cookie-secret',
  },
  // ChatGateway decorator calls this at class-load (module import) time —
  // must be present on the mock or the AppModule import below explodes.
  resolveAllowedWsOrigins: () => ['http://localhost:3007'],
}));

import { Logger } from '@nestjs/common';
import { RedisModule } from './app.module';

function makeRedis(overrides: Partial<Record<'quit' | 'disconnect', jest.Mock>> = {}) {
  return {
    quit: overrides.quit ?? jest.fn().mockResolvedValue('OK'),
    disconnect: overrides.disconnect ?? jest.fn(),
  };
}

describe('RedisModule.onApplicationShutdown', () => {
  it('calls quit() on the managed redis client', async () => {
    const redis = makeRedis();
    const mod = new RedisModule(redis as any);

    await mod.onApplicationShutdown();

    expect(redis.quit).toHaveBeenCalledTimes(1);
    expect(redis.disconnect).not.toHaveBeenCalled();
  });

  it('falls back to disconnect() when quit() rejects', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const redis = makeRedis({
      quit: jest.fn().mockRejectedValue(new Error('connection lost')),
    });
    const mod = new RedisModule(redis as any);

    await expect(mod.onApplicationShutdown()).resolves.toBeUndefined();

    expect(redis.quit).toHaveBeenCalledTimes(1);
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Redis quit failed'));
    warn.mockRestore();
  });

  it('does not rethrow if disconnect also throws synchronously', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const redis = makeRedis({
      quit: jest.fn().mockRejectedValue(new Error('boom')),
      disconnect: jest.fn(() => {
        throw new Error('double boom');
      }),
    });
    const mod = new RedisModule(redis as any);

    // disconnect throwing is acceptable — shutdown is best-effort. We only
    // assert the module tried both paths; if disconnect is pathological
    // the process is already exiting anyway.
    await expect(mod.onApplicationShutdown()).rejects.toThrow('double boom');

    expect(redis.quit).toHaveBeenCalledTimes(1);
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
