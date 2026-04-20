import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../config/environment';

@Injectable()
export class CacheService implements OnModuleDestroy {
  readonly client = new Redis({ host: env.REDIS_HOST, port: env.REDIS_PORT });

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.setex(key, ttlSeconds, value);
  }

  /**
   * Atomic SET NX EX — used for single-use anti-replay guards (TOTP codes,
   * password-reset tokens, idempotency keys). Returns `true` if the key was
   * newly written (caller owns the guard), `false` if it already existed
   * (replay / duplicate). Errors propagate to the caller for fail-closed
   * handling.
   */
  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    // `set key value EX ttl NX` — node-redis style. ioredis accepts the same
    // variadic argument shape: `client.set(key, value, 'EX', ttl, 'NX')`.
    // Returns 'OK' when stored, `null` when NX collided.
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) > 0;
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.client.del(...keys);
  }

  async sadd(key: string, ...members: string[]): Promise<void> {
    await this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<void> {
    await this.client.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
