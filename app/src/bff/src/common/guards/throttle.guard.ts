import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { ErrorCode, WireError } from '@app/contracts';
import {
  THROTTLE_METADATA_KEY,
  ThrottleOptions,
  ThrottleScope,
} from '../decorators/throttle.decorator';

export const REDIS_CLIENT = Symbol('BFF_REDIS_CLIENT');

const FAIL_CLOSED_SCOPES: ReadonlySet<ThrottleScope> = new Set(['login', 'reset']);

function shouldFailClosed(opts: ThrottleOptions): boolean {
  if (typeof opts.failClosed === 'boolean') return opts.failClosed;
  return FAIL_CLOSED_SCOPES.has(opts.scope);
}

function defaultKey(req: any): string {
  // `session.sub` is already the OIDC-style `u:{id}` / `a:{id}` identity
  // string, which matches the rate-limit key format we've always used —
  // so use it directly rather than re-parsing into numeric id + prefix.
  const sub = req?.session?.sub;
  if (typeof sub === 'string' && sub.length > 0) return sub;
  return `ip:${req?.ip ?? req?.socket?.remoteAddress ?? 'unknown'}`;
}

/**
 * Redis sliding-window rate-limit guard.
 *
 * Not registered globally. Apply per-endpoint via the Throttle decorator.
 * Storage layout: ratelimit:{scope}:{keyOrIp} as a sorted-set of
 * request timestamps (ms since epoch). Old entries are pruned by score,
 * current count is ZCARD. Key TTL = windowMs * 2 so abandoned buckets expire.
 */
@Injectable()
export class ThrottleGuard implements CanActivate {
  private readonly logger = new Logger(ThrottleGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const raw = this.reflector.getAllAndOverride<ThrottleOptions | ThrottleOptions[] | undefined>(
      THROTTLE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!raw) return true;

    const bucketList: ThrottleOptions[] = Array.isArray(raw) ? raw : [raw];
    if (bucketList.length === 0) return true;

    const req = context.switchToHttp().getRequest();

    for (const opts of bucketList) {
      await this.enforceBucket(opts, req);
    }
    return true;
  }

  private async enforceBucket(opts: ThrottleOptions, req: any): Promise<void> {
    const key = opts.keyFn ? opts.keyFn(req) : defaultKey(req);
    const redisKey = `ratelimit:${opts.scope}:${key}`;

    if (!this.redis) {
      this.handleRedisMiss(opts, 'redis client not provided');
      return;
    }

    try {
      const now = Date.now();
      const windowStart = now - opts.windowMs;
      const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;

      const pipeline = this.redis.multi();
      pipeline.zremrangebyscore(redisKey, 0, windowStart);
      pipeline.zadd(redisKey, now, member);
      pipeline.zcard(redisKey);
      pipeline.pexpire(redisKey, opts.windowMs * 2);
      const results = await pipeline.exec();

      if (!results) {
        this.handleRedisMiss(opts, 'empty pipeline result');
        return;
      }

      const zcardEntry = results[2];
      const count = Number(zcardEntry?.[1] ?? 0);

      if (count > opts.limit) {
        const oldest = await this.redis.zrange(redisKey, 0, 0, 'WITHSCORES');
        const oldestTs = oldest.length >= 2 ? Number(oldest[1]) : now;
        const retryAfterMs = Math.max(0, oldestTs + opts.windowMs - now);

        const body: WireError = {
          code: ErrorCode.RATE_LIMITED,
          message: 'Too many requests',
          retryAfterMs,
          details: { scope: opts.scope, limit: opts.limit, windowMs: opts.windowMs },
        };
        throw new HttpException(body as unknown as Record<string, unknown>, 429);
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.handleRedisMiss(opts, (err as Error)?.message ?? 'redis error');
    }
  }

  private handleRedisMiss(opts: ThrottleOptions, reason: string): boolean {
    if (shouldFailClosed(opts)) {
      this.logger.error(`ThrottleGuard fail-closed for scope=${opts.scope}: ${reason}`);
      const body: WireError = {
        code: ErrorCode.RATE_LIMITED,
        message: 'Rate limiter unavailable',
        details: { scope: opts.scope, reason: 'limiter_down' },
      };
      throw new HttpException(body as unknown as Record<string, unknown>, 429);
    }
    this.logger.warn(`ThrottleGuard fail-open for scope=${opts.scope}: ${reason}`);
    return true;
  }
}
