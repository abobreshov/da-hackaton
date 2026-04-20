/**
 * RedisIoAdapter.close() — quits the pub/sub ioredis clients during
 * NestJS teardown. Without this both clients survive app.close() and
 * keep the event loop alive via ioredis reconnect timers (CodeRabbit M1).
 */
jest.mock('@nestjs/platform-socket.io', () => {
  class FakeIoAdapter {
    constructor(_app?: unknown) {}
    async close(_server: any): Promise<void> {
      /* no-op super */
    }
  }
  return { IoAdapter: FakeIoAdapter };
});

jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: jest.fn(() => () => undefined),
}));

jest.mock('ioredis', () => {
  const ctor: any = jest.fn().mockImplementation(() => ({
    status: 'ready',
    on: jest.fn(),
    duplicate: jest.fn(() => ({
      status: 'ready',
      on: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
    })),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
  }));
  return { __esModule: true, default: ctor };
});

import { RedisIoAdapter } from './redis-io.adapter';

describe('RedisIoAdapter shutdown', () => {
  it('close() quits both pub and sub clients', async () => {
    const adapter: any = new RedisIoAdapter({} as any);
    await adapter.connectToRedis();

    const pub = adapter.pubClient;
    const sub = adapter.subClient;
    expect(pub).toBeDefined();
    expect(sub).toBeDefined();

    await adapter.close({} as any);

    expect(pub.quit).toHaveBeenCalledTimes(1);
    expect(sub.quit).toHaveBeenCalledTimes(1);
    // Cleared so double-close is a no-op.
    expect(adapter.pubClient).toBeUndefined();
    expect(adapter.subClient).toBeUndefined();
  });

  it('falls back to disconnect() when quit() rejects', async () => {
    const adapter: any = new RedisIoAdapter({} as any);
    await adapter.connectToRedis();

    const pub = adapter.pubClient;
    const sub = adapter.subClient;
    pub.quit = jest.fn().mockRejectedValue(new Error('sock reset'));
    sub.quit = jest.fn().mockRejectedValue(new Error('sock reset'));

    await adapter.close({} as any);

    expect(pub.quit).toHaveBeenCalledTimes(1);
    expect(sub.quit).toHaveBeenCalledTimes(1);
    expect(pub.disconnect).toHaveBeenCalledTimes(1);
    expect(sub.disconnect).toHaveBeenCalledTimes(1);
  });

  it('dispose() is equivalent (legacy callers)', async () => {
    const adapter: any = new RedisIoAdapter({} as any);
    await adapter.connectToRedis();
    const pub = adapter.pubClient;
    const sub = adapter.subClient;

    await adapter.dispose();

    expect(pub.quit).toHaveBeenCalledTimes(1);
    expect(sub.quit).toHaveBeenCalledTimes(1);
  });
});
