import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { env } from '../config/environment';

export interface SessionPayload {
  adminId?: number;
  userId?: number;
  email: string;
  name: string;
  type: 'admin' | 'user';
  scopes: string[];
  iat?: number;
  exp?: number;
}

const SESSION_COOKIE = 'session';
const REFRESH_COOKIE = 'refresh';

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: env.NODE_ENV === 'production',
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
