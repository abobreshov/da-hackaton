import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { env } from '../config/environment';

/**
 * Account kind carried inside the session payload.
 *
 * Kept as a first-class discriminator (separate from `sub`) because
 * `SessionGuard` / `AdminGuard` / `ThrottleGuard` all need to branch on it
 * without parsing the `sub` string every request.
 */
export type AccountType = 'user' | 'admin';

/**
 * OIDC-aligned session claims.
 *
 * Shape intentionally mirrors RFC 7519 + OIDC core (`sub`, `iat`, `exp`)
 * so when SSO / OpenID Connect lands we can swap the provider without
 * reshaping every consumer. `sub` is an opaque prefixed identity:
 *
 *   - `u:{numeric userId}`  for regular users
 *   - `a:{numeric adminId}` for admins
 *
 * The `u:` / `a:` prefix is load-bearing — `parseSub()` below is the only
 * place that encodes the mapping.
 */
export interface SessionPayload {
  /** OIDC-style subject. Stable opaque identity of the authenticated principal. */
  sub: string;
  type: AccountType;
  email: string;
  name: string;
  scopes: string[];
  iat?: number;
  exp?: number;
}

/**
 * Build an OIDC-style `sub` from the account type + numeric id.
 * Keep this the single writer for the prefix; tests assert on its output.
 */
export function makeSub(type: AccountType, numericId: number): string {
  return `${type === 'admin' ? 'a' : 'u'}:${numericId}`;
}

/**
 * Parse an OIDC-style `sub` back into `{ type, numericId }`.
 * Throws on malformed input so callers can treat a bad sub as a hard
 * auth failure (refuse the request) rather than silently propagating
 * a zeroed id downstream.
 */
export function parseSub(sub: string): { type: AccountType; numericId: number } {
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

const SESSION_COOKIE = 'session';
const REFRESH_COOKIE = 'refresh';

// Secure flag defaults to ON everywhere. Staging / tunnels / any non-prod
// environment that speaks HTTPS will therefore still get Secure=true without
// extra config. The ONLY way to turn it off is to explicitly set
// COOKIE_SECURE_DISABLED=true in the env — intended for the local dev stack
// which runs plain HTTP. Never set that flag in staging / production.
const COOKIE_SECURE = !env.COOKIE_SECURE_DISABLED;

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: COOKIE_SECURE,
  path: '/',
};

@Injectable()
export class CookieService {
  constructor(private readonly jwt: JwtService) {}

  setSessionCookie(reply: any, payload: Omit<SessionPayload, 'iat' | 'exp'>): void {
    const token = this.jwt.sign(payload, {
      secret: env.SESSION_COOKIE_SECRET,
      expiresIn: env.SESSION_COOKIE_TTL,
    });
    reply.setCookie(SESSION_COOKIE, token, {
      ...COOKIE_OPTS,
      signed: true,
      maxAge: env.SESSION_COOKIE_TTL,
    });
  }

  setRefreshCookie(reply: any, token: string): void {
    reply.setCookie(REFRESH_COOKIE, token, {
      ...COOKIE_OPTS,
      signed: true,
      maxAge: env.REFRESH_COOKIE_TTL,
    });
  }

  /**
   * Convenience for login/register/refresh flows: sets both the signed
   * session JWT cookie and the signed refresh cookie in one call.
   */
  issueAuthCookies(
    reply: any,
    args: { session: Omit<SessionPayload, 'iat' | 'exp'>; refreshToken: string },
  ): void {
    this.setSessionCookie(reply, args.session);
    this.setRefreshCookie(reply, args.refreshToken);
  }

  readSessionCookie(req: any): string | null {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (!raw) return null;
    const { value, valid } = req.unsignCookie(raw);
    return valid ? value : null;
  }

  readRefreshCookie(req: any): string | null {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) return null;
    const { value, valid } = req.unsignCookie(raw);
    return valid ? value : null;
  }

  verifySession(token: string): SessionPayload | null {
    try {
      return this.jwt.verify<SessionPayload>(token, { secret: env.SESSION_COOKIE_SECRET });
    } catch {
      return null;
    }
  }

  clearCookies(reply: any): void {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.clearCookie(REFRESH_COOKIE, { path: '/' });
  }
}
