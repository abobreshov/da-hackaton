import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter backed by Redis pub/sub so WS broadcasts propagate
 * across BFF replicas. Uses two ioredis clients (pub + sub) keyed off
 * REDIS_HOST / REDIS_PORT env vars.
 *
 * Not yet wired into main.ts — no WS gateway exists yet. When a gateway
 * lands, call app.useWebSocketAdapter(new RedisIoAdapter(app)) before
 * listen().
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private pubClient?: Redis;
  private subClient?: Redis;
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const host = process.env.REDIS_HOST ?? 'localhost';
    const port = Number(process.env.REDIS_PORT ?? 6379);

    this.pubClient = new Redis({ host, port, lazyConnect: false });
    this.subClient = this.pubClient.duplicate();

    this.pubClient.on('error', (e) => this.logger.error(`pub redis error: ${e.message}`));
    this.subClient.on('error', (e) => this.logger.error(`sub redis error: ${e.message}`));

    await Promise.all([
      this.pubClient.status === 'ready'
        ? Promise.resolve()
        : this.pubClient.connect().catch(() => undefined),
      this.subClient.status === 'ready'
        ? Promise.resolve()
        : this.subClient.connect().catch(() => undefined),
    ]);

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
    this.logger.log(`Socket.IO Redis adapter connected (${host}:${port})`);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    } else {
      this.logger.warn('createIOServer called before connectToRedis() — adapter not attached');
    }
    return server;
  }

  /** Quit a single ioredis client; fall back to sync `disconnect()` on
   *  error so shutdown always drains reconnect timers. */
  private async drain(client: Redis | undefined): Promise<void> {
    if (!client) return;
    try {
      await client.quit();
    } catch (err) {
      this.logger.warn(
        `Redis adapter quit failed, falling back to disconnect(): ${(err as Error)?.message}`,
      );
      try {
        client.disconnect();
      } catch {
        /* best-effort; process is exiting */
      }
    }
  }

  /**
   * Drain both clients on app shutdown. Called by Nest via the adapter
   * contract when `enableShutdownHooks()` fires. Safe to invoke twice —
   * second call is a no-op because fields are cleared.
   *
   * Signature matches `IoAdapter.close(server)` so Nest's shutdown dispatch
   * resolves to this override; the `server` arg is unused here because we
   * drain the pub/sub Redis clients, not socket.io's server instance.
   */
  async close(_server?: unknown): Promise<void> {
    const pub = this.pubClient;
    const sub = this.subClient;
    this.pubClient = undefined;
    this.subClient = undefined;
    this.adapterConstructor = undefined;
    await Promise.all([this.drain(pub), this.drain(sub)]);
  }

  /** Legacy alias retained for callers that still invoke `dispose()`. */
  async dispose(): Promise<void> {
    await this.close();
  }
}
