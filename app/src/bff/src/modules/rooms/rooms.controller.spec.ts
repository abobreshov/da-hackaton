// Stub env so transitive imports (microservice.module → environment) don't
// require real secrets at test time.
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

import { RpcException } from '@nestjs/microservices';
import { RoomsController } from './rooms.controller';

function makeServiceMock() {
  return {
    catalog: jest.fn(),
    listMy: jest.fn(),
    create: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    invite: jest.fn(),
    update: jest.fn(),
  };
}

function sessionReq(userId: number) {
  return {
    session: { sub: `u:${userId}`, email: 'u@x', name: 'u', type: 'user', scopes: [] },
  } as any;
}

describe('RoomsController (BFF)', () => {
  let svc: ReturnType<typeof makeServiceMock>;
  let controller: RoomsController;

  beforeEach(() => {
    svc = makeServiceMock();
    controller = new RoomsController(svc as any);
  });

  describe('GET /rooms/catalog', () => {
    it('delegates to service.catalog() and returns the list', async () => {
      const list = [{ id: 1, name: 'general' }];
      svc.catalog.mockResolvedValue(list);

      const res = await controller.catalog();

      expect(svc.catalog).toHaveBeenCalledWith();
      expect(res).toEqual(list);
    });

    it('propagates upstream RpcException unchanged', async () => {
      const rpc = new RpcException({ status: 502, message: 'down' });
      svc.catalog.mockRejectedValue(rpc);
      await expect(controller.catalog()).rejects.toBe(rpc);
    });
  });

  describe('GET /rooms/my', () => {
    it('passes userId from req.session to service.listMy', async () => {
      const rooms = [{ id: 5 }];
      svc.listMy.mockResolvedValue(rooms);

      const res = await controller.listMy(sessionReq(42));

      expect(svc.listMy).toHaveBeenCalledWith(42);
      expect(res).toEqual(rooms);
    });
  });

  describe('POST /rooms', () => {
    it('delegates to service.create with ownerId from session + body', async () => {
      const created = { id: 7, name: 'hackers', visibility: 'public' };
      svc.create.mockResolvedValue(created);

      const res = await controller.create(
        { name: 'hackers', visibility: 'public', description: 'welcome' } as any,
        sessionReq(11),
      );

      expect(svc.create).toHaveBeenCalledWith({
        ownerId: 11,
        name: 'hackers',
        visibility: 'public',
        description: 'welcome',
      });
      expect(res).toEqual(created);
    });

    it('omits description when not provided', async () => {
      svc.create.mockResolvedValue({ id: 8 });
      await controller.create(
        { name: 'private-room', visibility: 'private' } as any,
        sessionReq(1),
      );
      expect(svc.create).toHaveBeenCalledWith({
        ownerId: 1,
        name: 'private-room',
        visibility: 'private',
        description: undefined,
      });
    });

    it('propagates CONFLICT RpcException', async () => {
      const rpc = new RpcException({ status: 409, message: 'name taken' });
      svc.create.mockRejectedValue(rpc);
      await expect(
        controller.create({ name: 'dup', visibility: 'public' } as any, sessionReq(1)),
      ).rejects.toBe(rpc);
    });
  });

  describe('POST /rooms/:id/join', () => {
    it('delegates to service.join with userId + roomId from param', async () => {
      svc.join.mockResolvedValue(undefined);
      await controller.join(5, sessionReq(42));
      expect(svc.join).toHaveBeenCalledWith({ userId: 42, roomId: 5 });
    });

    it('propagates FORBIDDEN when banned', async () => {
      const rpc = new RpcException({ status: 403, message: 'banned' });
      svc.join.mockRejectedValue(rpc);
      await expect(controller.join(5, sessionReq(42))).rejects.toBe(rpc);
    });

    it('propagates NOT_FOUND when room missing', async () => {
      const rpc = new RpcException({ status: 404, message: 'no such room' });
      svc.join.mockRejectedValue(rpc);
      await expect(controller.join(99, sessionReq(1))).rejects.toBe(rpc);
    });
  });

  describe('POST /rooms/:id/leave', () => {
    it('delegates to service.leave with userId + roomId', async () => {
      svc.leave.mockResolvedValue({ ok: true });
      await controller.leave(5, sessionReq(42));
      expect(svc.leave).toHaveBeenCalledWith({ userId: 42, roomId: 5 });
    });

    it('propagates NOT_FOUND from upstream', async () => {
      const rpc = new RpcException({ status: 404, message: 'not a member' });
      svc.leave.mockRejectedValue(rpc);
      await expect(controller.leave(1, sessionReq(1))).rejects.toBe(rpc);
    });
  });

  describe('POST /rooms/:id/invitations', () => {
    it('delegates with inviteeId when body carries {invitedUserId}', async () => {
      svc.invite.mockResolvedValue({ id: 99, status: 'pending' });

      const res = await controller.invite(5, { invitedUserId: 4 } as any, sessionReq(3));

      expect(svc.invite).toHaveBeenCalledWith({
        inviterId: 3,
        inviteeId: 4,
        username: undefined,
        roomId: 5,
      });
      expect(res).toEqual({ id: 99, status: 'pending' });
    });

    it('delegates with username when body carries {username}', async () => {
      svc.invite.mockResolvedValue({ id: 100, status: 'pending' });

      const res = await controller.invite(5, { username: 'alice' } as any, sessionReq(3));

      expect(svc.invite).toHaveBeenCalledWith({
        inviterId: 3,
        inviteeId: undefined,
        username: 'alice',
        roomId: 5,
      });
      expect(res).toEqual({ id: 100, status: 'pending' });
    });

    it('propagates CONFLICT RpcException (duplicate invite)', async () => {
      const rpc = new RpcException({ status: 409, message: 'already invited' });
      svc.invite.mockRejectedValue(rpc);
      await expect(controller.invite(5, { invitedUserId: 4 } as any, sessionReq(3))).rejects.toBe(
        rpc,
      );
    });

    it('propagates FORBIDDEN (inviter not a member)', async () => {
      const rpc = new RpcException({ status: 403, message: 'not a member' });
      svc.invite.mockRejectedValue(rpc);
      await expect(controller.invite(5, { invitedUserId: 4 } as any, sessionReq(3))).rejects.toBe(
        rpc,
      );
    });
  });

  describe('PATCH /rooms/:id', () => {
    it('delegates to service.update with actorId from session + body patch', async () => {
      const updated = { id: 5, name: 'renamed', description: 'new', visibility: 'private' };
      svc.update.mockResolvedValue(updated);

      const res = await controller.update(
        5,
        { name: 'renamed', description: 'new', visibility: 'private' } as any,
        sessionReq(3),
      );

      expect(svc.update).toHaveBeenCalledWith({
        roomId: 5,
        actorId: 3,
        patch: { name: 'renamed', description: 'new', visibility: 'private' },
      });
      expect(res).toEqual(updated);
    });

    it('forwards partial patch (name only, others undefined)', async () => {
      svc.update.mockResolvedValue({ id: 5, name: 'x' });

      await controller.update(5, { name: 'x' } as any, sessionReq(3));

      expect(svc.update).toHaveBeenCalledWith({
        roomId: 5,
        actorId: 3,
        patch: { name: 'x', description: undefined, visibility: undefined },
      });
    });

    it('propagates FORBIDDEN (not the owner)', async () => {
      const rpc = new RpcException({ status: 403, message: 'not the owner' });
      svc.update.mockRejectedValue(rpc);
      await expect(controller.update(5, { name: 'x' } as any, sessionReq(9))).rejects.toBe(rpc);
    });

    it('propagates CONFLICT (name taken)', async () => {
      const rpc = new RpcException({ status: 409, message: 'name taken' });
      svc.update.mockRejectedValue(rpc);
      await expect(controller.update(5, { name: 'dup' } as any, sessionReq(3))).rejects.toBe(rpc);
    });
  });
});

describe('RoomsController — guard wiring (unauth 401 surface)', () => {
  // The controller itself is protected by SessionGuard at class level; unauth
  // requests never reach the handler. This smoke test asserts the guard
  // metadata is attached so mutations cannot be invoked anonymously.
  it('class-level metadata includes SessionGuard', () => {
    const { SessionGuard } = require('../../auth/session.guard');
    const guards = Reflect.getMetadata('__guards__', RoomsController) ?? [];
    expect(guards).toEqual(expect.arrayContaining([SessionGuard]));
  });
});

describe('RoomsController — throttle metadata (AC-14-13)', () => {
  const { THROTTLE_METADATA_KEY } = require('../../common/decorators/throttle.decorator');

  it('POST /rooms carries a throttle bucket {scope:room-create, limit:10, windowMs:3_600_000, failClosed:false}', () => {
    const meta = Reflect.getMetadata(THROTTLE_METADATA_KEY, RoomsController.prototype.create);

    expect(Array.isArray(meta)).toBe(true);
    const bucket = (meta ?? []).find((m: any) => m.scope === 'room-create');
    expect(bucket).toBeDefined();
    expect(bucket.limit).toBe(10);
    expect(bucket.windowMs).toBe(3_600_000);
    // Fail-open — we do not want to block room creation when Redis is down,
    // the spam bucket is advisory, not an auth boundary.
    expect(bucket.failClosed).toBe(false);
    expect(typeof bucket.keyFn).toBe('function');

    const key = bucket.keyFn({ session: { sub: 'u:42' } } as any);
    expect(key).toBe('u:42');
  });
});
