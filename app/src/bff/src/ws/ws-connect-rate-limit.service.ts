import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/guards/throttle.guard';

/**
 * AC-14-12 - 10 WS connects per 60 s per user.
 *
 * Kept separate from ThrottleGuard because the gateway wants a structured
 * decision ({ok, retryAfterMs}) instead of a thrown HttpException - the
 * transport cannot consume HTTP semantics mid-upgrade, it needs to close the
 * socket with 4429 and emit a WireError.
 */
export const WS_CONNECT_LIMIT = 10;
export const WS_CONNECT_WINDOW_MS = 60_000;
const KEY_PREFIX = 'ratelimit:wsconn:';

export interface WsConnectRateLimitResult {
  ok: boolean;
  retryAfterMs?: number;
}

@Injectable()
export class WsConnectRateLimit {
  private readonly logger = new Logger(WsConnectRateLimit.name);

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis) {}

  async check(userId: number): Promise<WsConnectRateLimitResult> {
    const redisKey = `${KEY_PREFIX}u:${userId}`;

    if (!this.redis) {
      this.logger.error(
        `WsConnectRateLimit fail-closed for user=${userId}: redis client not provided`,
      );
      return { ok: false, retryAfterMs: WS_CONNECT_WINDOW_MS };
    }

    try {
      const now = Date.now();
      const windowStart = now - WS_CONNECT_WINDOW_MS;
      const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;

      const pipeline = this.redis.multi();
      pipeline.zremrangebyscore(redisKey, 0, windowStart);
      pipeline.zadd(redisKey, now, member);
      pipeline.zcard(redisKey);
      // TTL slightly over the window so abandoned buckets expire but the
      // common case (reconnect storms) does not race a premature eviction.
      pipeline.pexpire(redisKey, WS_CONNECT_WINDOW_MS * 2);
      const results = await pipeline.exec();

      if (!results) {
        this.logger.error(
          `WsConnectRateLimit fail-closed for user=${userId}: empty pipeline result`,
        );
        return { ok: false, retryAfterMs: WS_CONNECT_WINDOW_MS };
      }

      const zcardEntry = results[2];
      const count = Number(zcardEntry?.[1] ?? 0);

      if (count > WS_CONNECT_LIMIT) {
        const oldest = await this.redis.zrange(redisKey, 0, 0, 'WITHSCORES');
        const oldestTs = oldest.length >= 2 ? Number(oldest[1]) : now;
        const retryAfterMs = Math.max(1, oldestTs + WS_CONNECT_WINDOW_MS - now);
        return { ok: false, retryAfterMs };
      }

      return { ok: true };
    } catch (err) {
      this.logger.error(
        `WsConnectRateLimit fail-closed for user=${userId}: ${(err as Error)?.message ?? 'redis error'}`,
      );
      return { ok: false, retryAfterMs: WS_CONNECT_WINDOW_MS };
    }
  }
}
