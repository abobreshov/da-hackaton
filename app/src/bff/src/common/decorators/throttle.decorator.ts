import { SetMetadata } from '@nestjs/common';

export type ThrottleScope = 'login' | 'reset' | 'msg' | string;

export interface ThrottleOptions {
  scope: ThrottleScope;
  /** Max requests allowed within the sliding window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * If true, block requests when Redis is unreachable (fail-closed).
   * Default inferred from scope: login/reset fail-closed, msg fail-open.
   */
  failClosed?: boolean;
  /**
   * Optional key override. If omitted, the guard uses the OIDC-style
   * `session.sub` (`u:<id>` / `a:<id>`) and falls back to `ip:<addr>`.
   */
  keyFn?: (req: any) => string;
}

export const THROTTLE_METADATA_KEY = 'bff:throttle';

/**
 * Apply a rate-limit. May be stacked — the guard ANDs all buckets together,
 * so the strictest one wins and each bucket is independently evaluated.
 *
 *   @Throttle({ scope: 'reset', limit: 1, windowMs: 60_000, failClosed: true })
 *   @Throttle({ scope: 'reset-ip', limit: 5, windowMs: 3_600_000, failClosed: true,
 *               keyFn: (req) => `ip:${req.ip}` })
 *   passwordResetRequest() { ... }
 */
export const Throttle = (opts: ThrottleOptions): MethodDecorator & ClassDecorator => {
  return ((target: any, propertyKey?: any, descriptor?: any) => {
    const existing: ThrottleOptions[] = Reflect.getMetadata
      ? (Reflect.getMetadata(THROTTLE_METADATA_KEY, descriptor ? descriptor.value : target) ?? [])
      : [];
    const merged = Array.isArray(existing) ? [...existing, opts] : [existing, opts];
    return SetMetadata(THROTTLE_METADATA_KEY, merged)(target, propertyKey, descriptor);
  }) as MethodDecorator & ClassDecorator;
};
