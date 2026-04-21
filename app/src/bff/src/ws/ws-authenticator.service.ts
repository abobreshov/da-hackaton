import { Inject, Injectable, Logger } from '@nestjs/common';
import fastifyCookie from '@fastify/cookie';
import type { Socket } from 'socket.io';
import { CookieService, parseSub } from '../auth/cookie.service';

/**
 * DI token for the `@fastify/cookie` Signer. Lives in the module so tests
 * can swap a stub without reaching into private internals — the gateway
 * itself never instantiates a signer directly.
 */
export const COOKIE_SIGNER = Symbol('COOKIE_SIGNER');

export interface WsSessionIdentity {
  userId: number;
  sessionId: string;
}

export interface CookieSigner {
  unsign(value: string): { value: string | null; valid: boolean };
}

/**
 * Authenticate a WS upgrade from the signed session cookie on the
 * handshake. Extracted out of ChatGateway for testability — the gateway
 * composes this service with origin/subscriber concerns.
 *
 * Returns `null` for:
 *   - missing cookie header
 *   - missing `session` cookie
 *   - invalid HMAC signature
 *   - JWT verification failure
 *   - admin sessions (WS is user-only per EPIC-03 AC-03-10)
 *   - user sessions without a numeric `userId`
 */
@Injectable()
export class WsAuthenticator {
  private readonly logger = new Logger(WsAuthenticator.name);

  constructor(
    private readonly cookieSvc: CookieService,
    @Inject(COOKIE_SIGNER) private readonly signer: CookieSigner,
  ) {}

  authenticate(socket: Socket): WsSessionIdentity | null {
    const header = socket.handshake?.headers?.cookie as string | undefined;
    if (!header) {
      this.logger.warn(`ws auth fail: no Cookie header on handshake (sid=${socket.id})`);
      return null;
    }

    const cookies = (fastifyCookie as any).parse(header) as Record<string, string>;
    if (!cookies || !cookies['session']) {
      this.logger.warn(
        `ws auth fail: no 'session' cookie in handshake (sid=${socket.id}, keys=${Object.keys(cookies ?? {}).join(',')})`,
      );
      return null;
    }

    const req = {
      cookies,
      unsignCookie: (v: string) => this.signer.unsign(v),
    } as any;

    const inner = this.cookieSvc.readSessionCookie(req);
    if (!inner) {
      this.logger.warn(`ws auth fail: signed cookie unsign rejected (sid=${socket.id})`);
      return null;
    }

    const session = this.cookieSvc.verifySession(inner);
    if (!session) {
      this.logger.warn(`ws auth fail: JWT verify rejected (sid=${socket.id})`);
      return null;
    }
    if (session.type !== 'user') {
      this.logger.warn(`ws auth fail: non-user session type=${session.type} (sid=${socket.id})`);
      return null;
    }
    if (!session.sub) {
      this.logger.warn(`ws auth fail: session has no sub (sid=${socket.id})`);
      return null;
    }

    // OIDC-style `sub` → numeric user id. A malformed sub (unlikely
    // post-SessionGuard) is treated as an unauthenticated socket.
    let numericId: number;
    try {
      const parsed = parseSub(session.sub);
      if (parsed.type !== 'user') return null;
      numericId = parsed.numericId;
    } catch {
      return null;
    }

    return { userId: numericId, sessionId: socket.id };
  }
}
