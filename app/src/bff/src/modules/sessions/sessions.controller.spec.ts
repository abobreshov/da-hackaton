/**
 * SessionsController (BFF) — thin delegation to SessionsService. Covers:
 *   - GET /sessions returns service list result for the session userId
 *   - DELETE /sessions/:id forwards string UUID + session userId, returns 204
 *   - :id is a string param (UUID, not int)
 *   - missing/non-user session sub throws
 */
jest.mock('../../config/environment', () => ({
  env: {
    SYSTEM_KEY: 'test-sys-key',
    TLS_ENABLED: false,
    BACKEND_TCP_HOST: '127.0.0.1',
    BACKEND_TCP_PORT: 4004,
    AUTH_TCP_HOST: '127.0.0.1',
    AUTH_TCP_PORT: 4003,
    NODE_ENV: 'test',
    SESSION_COOKIE_TTL: 900,
    REFRESH_COOKIE_TTL: 2_592_000,
    SESSION_COOKIE_SECRET: 'test-session-secret',
  },
}));

import 'reflect-metadata';
import { SessionsController } from './sessions.controller';

function makeServiceMock() {
  return {
    listForUser: jest.fn().mockResolvedValue({ sessions: [] }),
    revoke: jest.fn().mockResolvedValue({ ok: true }),
  };
}

function sessionReq(userId: number) {
  return {
    session: { sub: `u:${userId}`, type: 'user' },
  } as any;
}

describe('SessionsController (BFF)', () => {
  let svc: ReturnType<typeof makeServiceMock>;
  let controller: SessionsController;

  beforeEach(() => {
    svc = makeServiceMock();
    controller = new SessionsController(svc as any);
  });

  describe('GET /sessions', () => {
    it('forwards session userId and returns service result', async () => {
      const rows = [
        {
          id: '11111111-1111-1111-1111-111111111111',
          userId: 42,
          userAgent: 'curl/8',
          ip: '127.0.0.1',
          createdAt: new Date('2026-04-19T00:00:00Z'),
          lastSeenAt: new Date('2026-04-20T00:00:00Z'),
          revokedAt: null,
        },
      ];
      svc.listForUser.mockResolvedValue({ sessions: rows });

      const out = await controller.list(sessionReq(42));

      expect(svc.listForUser).toHaveBeenCalledWith(42);
      expect(out).toEqual({ sessions: rows });
    });

    it('throws when session sub is missing', () => {
      // `list` is synchronous — the userId guard throws before any service
      // call is made. Asserting via plain `toThrow` keeps the failure mode
      // honest (no swallowed promise rejection).
      expect(() => controller.list({ session: {} } as any)).toThrow(
        'no userId in session',
      );
      expect(svc.listForUser).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /sessions/:id', () => {
    it('forwards string id + session userId and returns void (204)', async () => {
      const id = 'abcdef01-2345-6789-abcd-ef0123456789';
      const out = await controller.revoke(id, sessionReq(42));

      expect(svc.revoke).toHaveBeenCalledWith({ sessionId: id, userId: 42 });
      expect(out).toBeUndefined();
    });

    it('passes id straight through as a string (no int parsing)', async () => {
      // A non-numeric UUID would explode under ParseIntPipe — assert the
      // controller accepts the raw string parameter unchanged.
      const id = 'not-a-number-uuid-style';
      await controller.revoke(id, sessionReq(7));
      expect(svc.revoke).toHaveBeenCalledWith({ sessionId: id, userId: 7 });
    });
  });
});
