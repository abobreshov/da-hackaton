import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

/**
 * Local copy of {@link parseSub} from `auth/cookie.service`.
 *
 * Inlined to keep this decorator import-light: pulling the cookie service
 * transitively loads `config/environment`, which validates env on import and
 * blows up in unit tests that don't seed `COOKIE_SECRET`/`SYSTEM_KEY`.
 * Behaviour stays in lockstep with `cookie.service#parseSub` — both must
 * reject the same shapes.
 */
function parseSubLocal(sub: string): { type: 'user' | 'admin'; numericId: number } {
  if (typeof sub !== 'string') {
    throw new Error(`invalid sub: ${String(sub)}`);
  }
  const idx = sub.indexOf(':');
  if (idx <= 0) throw new Error(`invalid sub (no prefix): ${sub}`);
  const prefix = sub.slice(0, idx);
  const numeric = Number(sub.slice(idx + 1));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`invalid sub (non-numeric id): ${sub}`);
  }
  if (prefix === 'u') return { type: 'user', numericId: numeric };
  if (prefix === 'a') return { type: 'admin', numericId: numeric };
  throw new Error(`invalid sub (unknown prefix ${prefix}): ${sub}`);
}

/**
 * Extracts the caller's numeric user id from `req.session.sub`.
 *
 * Throws {@link UnauthorizedException} when:
 * - the session is missing (guard misconfigured or anon request),
 * - `session.sub` is absent or malformed,
 * - the session belongs to an admin (admin sessions must not satisfy
 *   user-scoped endpoints — defence in depth against a guard slip).
 *
 * Context-safe: only touches `req` via `switchToHttp()`. For WS contexts
 * callers should read `client.data.session` directly; this decorator
 * deliberately does not span contexts so the failure mode stays explicit.
 */
export function __currentUserIdFactory(_data: unknown, ctx: ExecutionContext): number {
  const req: { session?: { sub?: string; type?: string } } = ctx.switchToHttp().getRequest();
  const sub = req?.session?.sub;
  if (!sub) {
    throw new UnauthorizedException('no session');
  }
  let parsed: { type: string; numericId: number };
  try {
    parsed = parseSubLocal(sub);
  } catch {
    throw new UnauthorizedException('invalid session sub');
  }
  if (parsed.type !== 'user') {
    throw new UnauthorizedException('user session required');
  }
  return parsed.numericId;
}

export const CurrentUserId = createParamDecorator(__currentUserIdFactory);
