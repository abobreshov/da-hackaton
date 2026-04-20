// Stub env so transitive imports (microservice.module → environment) don't
// require real secrets at test time. Mirrors rooms.controller.spec pattern.
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

import { BadRequestException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { MessagesController } from './messages.controller';

function makeServiceMock() {
  return {
    create: jest.fn(),
    list: jest.fn(),
    edit: jest.fn(),
    delete: jest.fn(),
    getById: jest.fn(),
    since: jest.fn(),
  };
}

function sessionReq(userId: number) {
  return {
    session: { sub: `u:${userId}`, email: 'u@x', name: 'u', type: 'user', scopes: [] },
  } as any;
}

describe('MessagesController (BFF)', () => {
  let svc: ReturnType<typeof makeServiceMock>;
  let controller: MessagesController;

  beforeEach(() => {
    svc = makeServiceMock();
    controller = new MessagesController(svc as any);
  });

  describe('POST /messages', () => {
    it('delegates to service.create with authorId from session + roomId body', async () => {
      const created = { id: '101', roomId: 5, body: 'hi' };
      svc.create.mockResolvedValue(created);

      const res = await controller.create({ roomId: 5, body: 'hi' } as any, sessionReq(7));

      expect(svc.create).toHaveBeenCalledWith({
        authorId: 7,
        roomId: 5,
        dmUserId: undefined,
        body: 'hi',
        replyToId: undefined,
      });
      expect(res).toEqual(created);
    });

    it('delegates to service.create with dmUserId + replyToId', async () => {
      svc.create.mockResolvedValue({ id: '202' });

      await controller.create(
        { dmUserId: 4, body: 'reply', replyToId: '200' } as any,
        sessionReq(3),
      );

      expect(svc.create).toHaveBeenCalledWith({
        authorId: 3,
        roomId: undefined,
        dmUserId: 4,
        body: 'reply',
        replyToId: '200',
      });
    });

    it('propagates FORBIDDEN from upstream', async () => {
      const rpc = new RpcException({ status: 403, message: 'not a member' });
      svc.create.mockRejectedValue(rpc);
      await expect(controller.create({ roomId: 5, body: 'x' } as any, sessionReq(7))).rejects.toBe(
        rpc,
      );
    });
  });

  describe('GET /rooms/:id/messages', () => {
    it('delegates to service.list with roomId + cursor query', async () => {
      const rows = [{ id: '50' }];
      svc.list.mockResolvedValue(rows);

      const res = await controller.listRoom(5, {
        before: '2026-04-20T10:00:00Z',
        beforeId: '60',
        limit: 25,
      } as any);

      expect(svc.list).toHaveBeenCalledWith({
        roomId: 5,
        beforeCreatedAt: '2026-04-20T10:00:00Z',
        beforeId: '60',
        limit: 25,
      });
      expect(res).toBe(rows);
    });

    it('defaults limit when query omits it', async () => {
      svc.list.mockResolvedValue([]);

      await controller.listRoom(5, {} as any);

      expect(svc.list).toHaveBeenCalledWith({
        roomId: 5,
        beforeCreatedAt: undefined,
        beforeId: undefined,
        limit: 50,
      });
    });

    it('propagates FORBIDDEN from upstream', async () => {
      const rpc = new RpcException({ status: 403, message: 'not a member' });
      svc.list.mockRejectedValue(rpc);
      await expect(controller.listRoom(5, {} as any)).rejects.toBe(rpc);
    });
  });

  describe('GET /dms/:userId/messages', () => {
    it('delegates to service.list with dmUserId', async () => {
      const rows = [{ id: '10' }];
      svc.list.mockResolvedValue(rows);

      const res = await controller.listDm(4, { limit: 10 } as any, sessionReq(3));

      expect(svc.list).toHaveBeenCalledWith({
        dmUserId: 4,
        beforeCreatedAt: undefined,
        beforeId: undefined,
        limit: 10,
      });
      expect(res).toBe(rows);
    });

    it('rejects self-DM with BAD_REQUEST (userId param === session userId)', () => {
      expect(() => controller.listDm(3, {} as any, sessionReq(3))).toThrow(BadRequestException);
      expect(svc.list).not.toHaveBeenCalled();
    });
  });

  describe('GET /messages/:id', () => {
    it('delegates to service.getById with actorId from session', async () => {
      const row = { id: '101', body: 'hi' };
      svc.getById.mockResolvedValue(row);

      const res = await controller.getById('101', sessionReq(7));

      expect(svc.getById).toHaveBeenCalledWith({
        messageId: '101',
        actorId: 7,
      });
      expect(res).toBe(row);
    });

    it('propagates NOT_FOUND from upstream', async () => {
      const rpc = new RpcException({ status: 404, message: 'no such message' });
      svc.getById.mockRejectedValue(rpc);
      await expect(controller.getById('999', sessionReq(7))).rejects.toBe(rpc);
    });
  });

  describe('PATCH /messages/:id', () => {
    it('delegates to service.edit with actorId + body', async () => {
      svc.edit.mockResolvedValue({ id: '101', body: 'fix' });

      const res = await controller.edit('101', { body: 'fix' } as any, sessionReq(7));

      expect(svc.edit).toHaveBeenCalledWith({
        messageId: '101',
        actorId: 7,
        body: 'fix',
      });
      expect(res).toEqual({ id: '101', body: 'fix' });
    });

    it('propagates FORBIDDEN (not the author)', async () => {
      const rpc = new RpcException({ status: 403, message: 'not the author' });
      svc.edit.mockRejectedValue(rpc);
      await expect(controller.edit('101', { body: 'x' } as any, sessionReq(9))).rejects.toBe(rpc);
    });
  });

  describe('DELETE /messages/:id', () => {
    it('delegates to service.delete with actorId', async () => {
      svc.delete.mockResolvedValue(undefined);

      await controller.delete('101', sessionReq(7));

      expect(svc.delete).toHaveBeenCalledWith({
        messageId: '101',
        actorId: 7,
      });
    });

    it('propagates NOT_FOUND from upstream', async () => {
      const rpc = new RpcException({ status: 404, message: 'no such message' });
      svc.delete.mockRejectedValue(rpc);
      await expect(controller.delete('999', sessionReq(7))).rejects.toBe(rpc);
    });
  });
});

describe('MessagesController — guard wiring (unauth 401 surface)', () => {
  it('class-level metadata includes SessionGuard', () => {
    const { SessionGuard } = require('../../auth/session.guard');
    const guards = Reflect.getMetadata('__guards__', MessagesController) ?? [];
    expect(guards).toEqual(expect.arrayContaining([SessionGuard]));
  });
});
