/**
 * FriendsController (BFF) — thin delegation to FriendsService.
 *
 * The controller has no business logic beyond extracting the session userId
 * and forwarding. This spec asserts:
 *   - each handler passes the right arguments to the service
 *   - the class-level SessionGuard is attached (unauth → 401 surface)
 *   - AC-14-13: POST /friends/request carries a per-user Throttle bucket
 *     (friend-req, 20/hr, fail-open).
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
import { RpcException } from '@nestjs/microservices';
import { FriendsController } from './friends.controller';
import { THROTTLE_METADATA_KEY, ThrottleOptions } from '../../common/decorators/throttle.decorator';

function makeServiceMock() {
  return {
    list: jest.fn(),
    listPending: jest.fn(),
    request: jest.fn(),
    accept: jest.fn(),
    reject: jest.fn(),
    remove: jest.fn(),
  };
}

function sessionReq(userId: number) {
  return {
    session: { sub: `u:${userId}`, email: 'u@x', name: 'u', type: 'user', scopes: [] },
  } as any;
}

describe('FriendsController (BFF)', () => {
  let svc: ReturnType<typeof makeServiceMock>;
  let controller: FriendsController;

  beforeEach(() => {
    svc = makeServiceMock();
    controller = new FriendsController(svc as any);
  });

  describe('GET /friends', () => {
    it('delegates to service.list with userId from session', async () => {
      svc.list.mockResolvedValue([{ userId: 2 }]);
      const res = await controller.list(sessionReq(1));
      expect(svc.list).toHaveBeenCalledWith({ userId: 1 });
      expect(res).toEqual([{ userId: 2 }]);
    });
  });

  describe('GET /friends/pending', () => {
    it('delegates to service.listPending with userId from session', async () => {
      svc.listPending.mockResolvedValue([{ id: 9 }]);
      const res = await controller.listPending(sessionReq(1));
      expect(svc.listPending).toHaveBeenCalledWith({ userId: 1 });
      expect(res).toEqual([{ id: 9 }]);
    });
  });

  describe('POST /friends/request', () => {
    it('delegates to service.request with requesterId from session + body', async () => {
      svc.request.mockResolvedValue({ id: 99, status: 'pending' });

      const res = await controller.request(
        { username: 'bob', text: 'hi' } as any,
        sessionReq(1),
      );

      expect(svc.request).toHaveBeenCalledWith({
        requesterId: 1,
        targetUsername: 'bob',
        text: 'hi',
      });
      expect(res).toEqual({ id: 99, status: 'pending' });
    });

    it('propagates CONFLICT RpcException (already friends)', async () => {
      const rpc = new RpcException({ status: 409, message: 'already friends' });
      svc.request.mockRejectedValue(rpc);
      await expect(
        controller.request({ username: 'bob' } as any, sessionReq(1)),
      ).rejects.toBe(rpc);
    });
  });

  describe('POST /friends/requests/:id/accept', () => {
    it('delegates to service.accept with userId + requestId', async () => {
      svc.accept.mockResolvedValue(undefined);
      await controller.accept(42, sessionReq(1));
      expect(svc.accept).toHaveBeenCalledWith({ userId: 1, requestId: 42 });
    });
  });

  describe('POST /friends/requests/:id/reject', () => {
    it('delegates to service.reject with userId + requestId', async () => {
      svc.reject.mockResolvedValue(undefined);
      await controller.reject(42, sessionReq(1));
      expect(svc.reject).toHaveBeenCalledWith({ userId: 1, requestId: 42 });
    });
  });

  describe('DELETE /friends/:userId', () => {
    it('delegates to service.remove with userId + otherUserId', async () => {
      svc.remove.mockResolvedValue(undefined);
      await controller.remove(99, sessionReq(1));
      expect(svc.remove).toHaveBeenCalledWith({ userId: 1, otherUserId: 99 });
    });
  });
});

describe('FriendsController — guard wiring + throttle metadata', () => {
  it('class-level metadata includes SessionGuard', () => {
    const { SessionGuard } = require('../../auth/session.guard');
    const guards =
      Reflect.getMetadata('__guards__', FriendsController) ?? [];
    expect(guards).toEqual(expect.arrayContaining([SessionGuard]));
  });

  // AC-14-13 — POST /friends/request: 20/hr per userId, fail-open.
  it('POST /friends/request carries a throttle bucket {scope:friend-req, limit:20, windowMs:3_600_000, failClosed:false}', () => {
    const meta = Reflect.getMetadata(
      THROTTLE_METADATA_KEY,
      FriendsController.prototype.request,
    ) as ThrottleOptions[] | undefined;

    expect(Array.isArray(meta)).toBe(true);
    const bucket = (meta ?? []).find((m) => m.scope === 'friend-req');
    expect(bucket).toBeDefined();
    expect(bucket!.limit).toBe(20);
    expect(bucket!.windowMs).toBe(3_600_000);
    // Spam suppression is advisory (not a security boundary) → fail-open
    // when Redis is down so legitimate users are not locked out.
    expect(bucket!.failClosed).toBe(false);
    expect(typeof bucket!.keyFn).toBe('function');

    // The keyFn must scope by authenticated userId (not IP) — session-based
    // spam buckets survive NAT / IP rotation.
    const key = bucket!.keyFn!({ session: { sub: 'u:42' } } as any);
    expect(key).toBe('u:42');
  });
});
