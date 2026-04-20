/**
 * UnreadController (BFF) — thin delegation to UnreadService. Covers:
 *   - session userId extraction + forwarding
 *   - self-DM short-circuit with BadRequestException
 *   - payload shape (`lastReadId` flows through as string; peer goes as dmUserId)
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
import { BadRequestException } from '@nestjs/common';
import { UnreadController } from './unread.controller';

function makeServiceMock() {
  return {
    markReadRoom: jest.fn().mockResolvedValue({ ok: true }),
    markReadDm: jest.fn().mockResolvedValue({ ok: true }),
    getForUser: jest.fn().mockResolvedValue({ rooms: [], dms: [] }),
  };
}

function sessionReq(userId: number) {
  return {
    session: { sub: `u:${userId}`, type: 'user' },
  } as any;
}

describe('UnreadController (BFF)', () => {
  let svc: ReturnType<typeof makeServiceMock>;
  let controller: UnreadController;

  beforeEach(() => {
    svc = makeServiceMock();
    controller = new UnreadController(svc as any);
  });

  describe('POST /rooms/:id/read', () => {
    it('forwards userId from session + path roomId + body lastReadId', async () => {
      await controller.markReadRoom(7, { lastReadId: '123' }, sessionReq(42));
      expect(svc.markReadRoom).toHaveBeenCalledWith({
        userId: 42,
        roomId: 7,
        lastReadId: '123',
      });
    });
  });

  describe('POST /dms/:userId/read', () => {
    it('forwards peer userId as dmUserId', async () => {
      await controller.markReadDm(99, { lastReadId: '200' }, sessionReq(42));
      expect(svc.markReadDm).toHaveBeenCalledWith({
        userId: 42,
        dmUserId: 99,
        lastReadId: '200',
      });
    });

    it('rejects self-DM with BadRequestException', async () => {
      await expect(
        controller.markReadDm(42, { lastReadId: '1' }, sessionReq(42)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(svc.markReadDm).not.toHaveBeenCalled();
    });
  });

  describe('GET /unread', () => {
    it('forwards session userId and returns service result', async () => {
      svc.getForUser.mockResolvedValue({
        rooms: [{ roomId: 1, count: 3 }],
        dms: [{ dmId: 5, count: 7 }],
      });
      const out = await controller.getForUser(sessionReq(42));
      expect(svc.getForUser).toHaveBeenCalledWith(42);
      expect(out).toEqual({
        rooms: [{ roomId: 1, count: 3 }],
        dms: [{ dmId: 5, count: 7 }],
      });
    });
  });
});
