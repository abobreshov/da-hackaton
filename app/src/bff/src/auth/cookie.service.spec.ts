/**
 * CookieService — two-layer signed cookie roundtrip.
 *
 * Layer 1: @fastify/cookie HMAC (outer wrapper) — mocked via reply.setCookie /
 *          req.unsignCookie on the fastify side.
 * Layer 2: JWT signed with SESSION_COOKIE_SECRET (inner session value) — real
 *          @nestjs/jwt JwtService is used so sign/verify roundtrip is exercised.
 *
 * env is stubbed so tests don't require a real .env at collection time.
 */
// Env mock is mutated per-test to exercise COOKIE_SECURE_DISABLED branches.
const mockEnv: Record<string, unknown> = {
  NODE_ENV: 'test',
  SESSION_COOKIE_SECRET: 's'.repeat(32),
  SESSION_COOKIE_TTL: 900,
  REFRESH_COOKIE_TTL: 604_800,
  COOKIE_SECURE_DISABLED: false,
};
jest.mock('../config/environment', () => ({
  get env() {
    return mockEnv;
  },
}));

import { JwtService } from '@nestjs/jwt';
import { CookieService, SessionPayload, makeSub, parseSub } from './cookie.service';

function makeReply() {
  return {
    setCookie: jest.fn(),
    clearCookie: jest.fn(),
  };
}

function makeReq(cookies: Record<string, string> = {}, unsigned: Record<string, { value: string; valid: boolean }> = {}) {
  return {
    cookies,
    // @fastify/cookie mock: default to valid HMAC, whatever comes in round-trips out.
    unsignCookie: jest.fn((raw: string) => unsigned[raw] ?? { value: raw, valid: true }),
  } as any;
}

describe('makeSub / parseSub', () => {
  it('makeSub builds the `u:<id>` / `a:<id>` form', () => {
    expect(makeSub('user', 7)).toBe('u:7');
    expect(makeSub('admin', 42)).toBe('a:42');
  });

  it('parseSub reverses makeSub', () => {
    expect(parseSub('u:7')).toEqual({ type: 'user', numericId: 7 });
    expect(parseSub('a:42')).toEqual({ type: 'admin', numericId: 42 });
  });

  it('parseSub throws on malformed input', () => {
    expect(() => parseSub('' as any)).toThrow();
    expect(() => parseSub('garbage')).toThrow();
    expect(() => parseSub('x:1')).toThrow();
    expect(() => parseSub('u:abc')).toThrow();
    expect(() => parseSub('u:-1')).toThrow();
    expect(() => parseSub('u:0')).toThrow();
  });
});

describe('CookieService', () => {
  let jwt: JwtService;
  let svc: CookieService;

  beforeEach(() => {
    jwt = new JwtService({});
    svc = new CookieService(jwt);
  });

  describe('setSessionCookie', () => {
    it('signs the payload as a JWT and sets a fastify-signed cookie', () => {
      const reply = makeReply();
      const payload: Omit<SessionPayload, 'iat' | 'exp'> = {
        sub: makeSub('user', 7),
        email: 'a@b.com',
        name: 'alice',
        type: 'user',
        scopes: ['chat'],
      };

      svc.setSessionCookie(reply as any, payload);

      expect(reply.setCookie).toHaveBeenCalledTimes(1);
      const [name, token, opts] = reply.setCookie.mock.calls[0];
      expect(name).toBe('session');
      expect(typeof token).toBe('string');
      // Real JwtService output is three dot-separated b64 segments.
      expect(token.split('.').length).toBe(3);
      expect(opts).toEqual(
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          // Secure now defaults ON regardless of NODE_ENV — explicit
          // COOKIE_SECURE_DISABLED=true is the only way to turn it off.
          secure: true,
          signed: true,
          path: '/',
          maxAge: 900,
        }),
      );

      // Sanity-check: verify the inner JWT decodes back to the payload.
      const decoded = jwt.verify<SessionPayload>(token, { secret: 's'.repeat(32) });
      expect(decoded).toEqual(expect.objectContaining(payload));
    });
  });

  describe('setRefreshCookie', () => {
    it('sets refresh cookie with signed flag and refresh TTL', () => {
      const reply = makeReply();
      svc.setRefreshCookie(reply as any, 'u:abcdef');

      expect(reply.setCookie).toHaveBeenCalledWith(
        'refresh',
        'u:abcdef',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          signed: true,
          path: '/',
          maxAge: 604_800,
        }),
      );
    });
  });

  describe('issueAuthCookies', () => {
    it('sets both session and refresh cookies in one call', () => {
      const reply = makeReply();
      const session: Omit<SessionPayload, 'iat' | 'exp'> = {
        sub: makeSub('admin', 1),
        email: 'x@y',
        name: 'admin',
        type: 'admin',
        scopes: [],
      };
      svc.issueAuthCookies(reply as any, { session, refreshToken: 'a:tok' });

      expect(reply.setCookie).toHaveBeenCalledTimes(2);
      expect(reply.setCookie.mock.calls[0][0]).toBe('session');
      expect(reply.setCookie.mock.calls[1][0]).toBe('refresh');
      expect(reply.setCookie.mock.calls[1][1]).toBe('a:tok');
    });
  });

  describe('readSessionCookie', () => {
    it('returns null when no cookie present', () => {
      const req = makeReq({});
      expect(svc.readSessionCookie(req)).toBeNull();
    });

    it('returns null when cookies bag is missing entirely', () => {
      const req: any = { unsignCookie: jest.fn() };
      expect(svc.readSessionCookie(req)).toBeNull();
    });

    it('returns unsigned value when HMAC is valid', () => {
      const req = makeReq({ session: 'signed-raw' }, { 'signed-raw': { value: 'inner-jwt', valid: true } });
      expect(svc.readSessionCookie(req)).toBe('inner-jwt');
      expect(req.unsignCookie).toHaveBeenCalledWith('signed-raw');
    });

    it('returns null when HMAC signature is tampered / invalid', () => {
      const req = makeReq({ session: 'tampered' }, { tampered: { value: '', valid: false } });
      expect(svc.readSessionCookie(req)).toBeNull();
    });
  });

  describe('readRefreshCookie', () => {
    it('returns null when no cookie present', () => {
      const req = makeReq({});
      expect(svc.readRefreshCookie(req)).toBeNull();
    });

    it('returns unsigned refresh value when HMAC valid', () => {
      const req = makeReq({ refresh: 'signed-refresh' }, { 'signed-refresh': { value: 'u:raw', valid: true } });
      expect(svc.readRefreshCookie(req)).toBe('u:raw');
    });

    it('returns null when HMAC invalid', () => {
      const req = makeReq({ refresh: 'bad' }, { bad: { value: '', valid: false } });
      expect(svc.readRefreshCookie(req)).toBeNull();
    });
  });

  describe('verifySession (inner JWT layer)', () => {
    it('roundtrips sign → verify with the configured secret', () => {
      const reply = makeReply();
      svc.setSessionCookie(reply as any, {
        sub: makeSub('user', 11),
        email: 'r@t.com',
        name: 'r',
        type: 'user',
        scopes: [],
      });
      const token = reply.setCookie.mock.calls[0][1];
      const decoded = svc.verifySession(token);
      expect(decoded).toEqual(
        expect.objectContaining({ sub: 'u:11', email: 'r@t.com', type: 'user' }),
      );
      // JwtService adds iat/exp → presence proves real signing ran.
      expect(typeof decoded!.iat).toBe('number');
      expect(typeof decoded!.exp).toBe('number');
    });

    it('returns null for a token signed with a different secret', () => {
      const otherJwt = new JwtService({});
      const bad = otherJwt.sign(
        { sub: 'u:1', email: 'x', name: 'x', type: 'user', scopes: [] },
        { secret: 'z'.repeat(32) },
      );
      expect(svc.verifySession(bad)).toBeNull();
    });

    it('returns null for garbage tokens', () => {
      expect(svc.verifySession('not-a-jwt')).toBeNull();
    });

    it('returns null for an expired token', () => {
      // Sign with past exp.
      const tok = jwt.sign(
        { sub: 'u:1', email: 'x', name: 'x', type: 'user', scopes: [] },
        { secret: 's'.repeat(32), expiresIn: -10 },
      );
      expect(svc.verifySession(tok)).toBeNull();
    });
  });

  describe('clearCookies', () => {
    it('clears both session and refresh cookies with path=/', () => {
      const reply = makeReply();
      svc.clearCookies(reply as any);

      expect(reply.clearCookie).toHaveBeenCalledTimes(2);
      expect(reply.clearCookie).toHaveBeenNthCalledWith(1, 'session', { path: '/' });
      expect(reply.clearCookie).toHaveBeenNthCalledWith(2, 'refresh', { path: '/' });
    });
  });

  // COOKIE_SECURE is evaluated at module load (top-level const), so exercising
  // the COOKIE_SECURE_DISABLED branches requires reloading cookie.service.ts
  // in isolation with a mutated env mock.
  describe('COOKIE_SECURE_DISABLED gating', () => {
    it('default env (COOKIE_SECURE_DISABLED=false) → Secure=true even when NODE_ENV=test', () => {
      jest.isolateModules(() => {
        mockEnv.COOKIE_SECURE_DISABLED = false;
        mockEnv.NODE_ENV = 'test';
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('./cookie.service');
        const localSvc = new mod.CookieService(new JwtService({}));
        const reply = makeReply();
        localSvc.setSessionCookie(reply as any, {
          sub: 'u:1',
          email: 'x@y.z',
          name: 'x',
          type: 'user',
          scopes: [],
        });
        const opts = reply.setCookie.mock.calls[0][2];
        expect(opts.secure).toBe(true);
      });
    });

    it('COOKIE_SECURE_DISABLED=true → Secure=false (dev-only plain-HTTP opt-out)', () => {
      jest.isolateModules(() => {
        mockEnv.COOKIE_SECURE_DISABLED = true;
        mockEnv.NODE_ENV = 'development';
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('./cookie.service');
        const localSvc = new mod.CookieService(new JwtService({}));
        const reply = makeReply();
        localSvc.setSessionCookie(reply as any, {
          sub: 'u:1',
          email: 'x@y.z',
          name: 'x',
          type: 'user',
          scopes: [],
        });
        const opts = reply.setCookie.mock.calls[0][2];
        expect(opts.secure).toBe(false);
      });
      // Restore default for subsequent tests.
      mockEnv.COOKIE_SECURE_DISABLED = false;
      mockEnv.NODE_ENV = 'test';
    });
  });
});
