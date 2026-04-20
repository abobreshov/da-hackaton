/**
 * WsAuthenticator extracts the signed session JWT from a Socket's
 * handshake cookie header and returns `{ userId, sessionId } | null`.
 *
 * Responsibilities are deliberately narrow:
 *   - Parse the `cookie` header via @fastify/cookie.
 *   - Call `Signer.unsign` with the COOKIE_SECRET-bound signer provided
 *     through the `COOKIE_SIGNER` DI token (testability).
 *   - Delegate JWT verification to CookieService.
 *   - Reject non-`user` sessions (admins stay on HTTP).
 *
 * Anything outside that (origin checks, disconnect, subscriber fanout)
 * stays in ChatGateway.
 */
jest.mock('../config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    SYSTEM_KEY: 'test-sys-key',
    TLS_ENABLED: false,
    COOKIE_SECRET: 'c'.repeat(32),
    SESSION_COOKIE_SECRET: 's'.repeat(32),
    SESSION_COOKIE_TTL: 900,
    REFRESH_COOKIE_TTL: 604_800,
    ALLOWED_ORIGINS: 'http://localhost:3007',
    BACKEND_TCP_HOST: '127.0.0.1',
    BACKEND_TCP_PORT: 4004,
    AUTH_TCP_HOST: '127.0.0.1',
    AUTH_TCP_PORT: 4003,
  },
}));

import { WsAuthenticator } from './ws-authenticator.service';

function makeCookieService() {
  return {
    readSessionCookie: jest.fn(),
    verifySession: jest.fn(),
  } as any;
}

function makeSigner(valid = true) {
  return {
    unsign: jest.fn((v: string) => ({ value: v, valid })),
  } as any;
}

function makeSocket(header?: string): any {
  return {
    id: 'sock-1',
    handshake: {
      headers: header ? { cookie: header } : {},
    },
  };
}

describe('WsAuthenticator', () => {
  let cookieSvc: ReturnType<typeof makeCookieService>;
  let signer: ReturnType<typeof makeSigner>;
  let auth: WsAuthenticator;

  beforeEach(() => {
    cookieSvc = makeCookieService();
    signer = makeSigner(true);
    auth = new WsAuthenticator(cookieSvc, signer);
  });

  describe('authenticate(socket)', () => {
    it('returns null when cookie header missing', () => {
      expect(auth.authenticate(makeSocket())).toBeNull();
      expect(cookieSvc.readSessionCookie).not.toHaveBeenCalled();
    });

    it('returns null when session cookie absent from header', () => {
      expect(auth.authenticate(makeSocket('other=abc'))).toBeNull();
      expect(cookieSvc.readSessionCookie).not.toHaveBeenCalled();
    });

    it('returns null when signature invalid', () => {
      signer = makeSigner(false);
      auth = new WsAuthenticator(cookieSvc, signer);
      cookieSvc.readSessionCookie.mockReturnValue(null);

      expect(auth.authenticate(makeSocket('session=signed.jwt'))).toBeNull();
    });

    it('returns null when JWT verification fails', () => {
      cookieSvc.readSessionCookie.mockReturnValue('inner.jwt');
      cookieSvc.verifySession.mockReturnValue(null);

      expect(auth.authenticate(makeSocket('session=signed.jwt'))).toBeNull();
    });

    it('returns null for admin sessions (WS is user-only)', () => {
      cookieSvc.readSessionCookie.mockReturnValue('inner.jwt');
      cookieSvc.verifySession.mockReturnValue({
        sub: 'a:1',
        type: 'admin',
        email: 'a@x',
        name: 'a',
        scopes: [],
      });

      expect(auth.authenticate(makeSocket('session=signed.jwt'))).toBeNull();
    });

    it('returns null when type=user but sub missing', () => {
      cookieSvc.readSessionCookie.mockReturnValue('inner.jwt');
      cookieSvc.verifySession.mockReturnValue({
        type: 'user',
        email: 'u@x',
        name: 'u',
        scopes: [],
      });

      expect(auth.authenticate(makeSocket('session=signed.jwt'))).toBeNull();
    });

    it('returns null when sub is malformed', () => {
      cookieSvc.readSessionCookie.mockReturnValue('inner.jwt');
      cookieSvc.verifySession.mockReturnValue({
        sub: 'garbage',
        type: 'user',
        email: 'u@x',
        name: 'u',
        scopes: [],
      });

      expect(auth.authenticate(makeSocket('session=signed.jwt'))).toBeNull();
    });

    it('returns { userId, sessionId } for valid user session', () => {
      cookieSvc.readSessionCookie.mockReturnValue('inner.jwt');
      cookieSvc.verifySession.mockReturnValue({
        sub: 'u:42',
        type: 'user',
        email: 'u@x',
        name: 'u',
        scopes: [],
      });

      const socket = makeSocket('session=signed.jwt');
      expect(auth.authenticate(socket)).toEqual({ userId: 42, sessionId: 'sock-1' });
    });

    it('passes the delegated req shape to CookieService.readSessionCookie', () => {
      cookieSvc.readSessionCookie.mockReturnValue('inner.jwt');
      cookieSvc.verifySession.mockReturnValue({
        sub: 'u:42',
        type: 'user',
        email: 'u@x',
        name: 'u',
        scopes: [],
      });

      auth.authenticate(makeSocket('session=signed.jwt'));

      const req = cookieSvc.readSessionCookie.mock.calls[0][0];
      expect(req.cookies).toMatchObject({ session: 'signed.jwt' });
      expect(typeof req.unsignCookie).toBe('function');
      // The delegated unsign wraps the injected signer.
      req.unsignCookie('anything');
      expect(signer.unsign).toHaveBeenCalledWith('anything');
    });
  });
});
