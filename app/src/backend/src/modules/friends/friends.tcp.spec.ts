/**
 * TCP-layer FriendsTcpController — @MessagePattern handlers dispatch straight
 * to the service. HttpException -> RpcException translation is handled by the
 * global `RpcExceptionFilter` (covered in its own spec); here we just assert
 * wiring, payload forwarding, and raw HttpException propagation.
 */

jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

import { ConflictException, NotFoundException } from '@nestjs/common';
import { FriendsTcpController } from './friends.tcp';
import type { FriendsService } from './friends.service';

function makeService(): jest.Mocked<FriendsService> {
  return {
    request: jest.fn(),
    accept: jest.fn(),
    reject: jest.fn(),
    remove: jest.fn(),
    list: jest.fn(),
    listPending: jest.fn(),
  } as unknown as jest.Mocked<FriendsService>;
}

describe('FriendsTcpController', () => {
  let service: jest.Mocked<FriendsService>;
  let controller: FriendsTcpController;

  beforeEach(() => {
    service = makeService();
    controller = new FriendsTcpController(service);
  });

  it('exposes a @MessagePattern per friends action with expected cmd strings', () => {
    const expected = new Set<string>([
      'friends.request',
      'friends.accept',
      'friends.reject',
      'friends.remove',
      'friends.list',
      'friends.listPending',
    ]);

    const proto = Object.getPrototypeOf(controller);
    const methods = Object.getOwnPropertyNames(proto).filter((m) => m !== 'constructor');

    const seenCmds = new Set<string>();
    for (const m of methods) {
      const raw = Reflect.getMetadata('microservices:pattern', proto[m]);
      if (!raw) continue;
      const patterns: unknown[] = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? ([] as unknown[]).concat(JSON.parse(raw))
          : [raw];
      for (const p of patterns) {
        if (typeof p === 'string') seenCmds.add(p);
        else if (p && typeof (p as { cmd?: unknown }).cmd === 'string') {
          seenCmds.add((p as { cmd: string }).cmd);
        }
      }
    }

    expect(seenCmds).toEqual(expected);
  });

  // ---------------------------------------------------------------------------
  // request
  // ---------------------------------------------------------------------------

  it('friends.request forwards payload to service.request', async () => {
    service.request.mockResolvedValue({ id: 11 } as any);
    const out = await controller.request({ requesterId: 1, targetUsername: 'bob', text: 'hi' });
    expect(service.request).toHaveBeenCalledWith({
      requesterId: 1,
      targetUsername: 'bob',
      text: 'hi',
    });
    expect(out).toEqual({ id: 11 });
  });

  it('friends.request propagates NotFoundException (filter maps to Rpc(404))', async () => {
    service.request.mockRejectedValue(new NotFoundException("user 'ghost' not found"));
    await expect(
      controller.request({ requesterId: 1, targetUsername: 'ghost' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ---------------------------------------------------------------------------
  // accept / reject
  // ---------------------------------------------------------------------------

  it('friends.accept forwards payload to service.accept', async () => {
    service.accept.mockResolvedValue({ ok: true });
    await controller.accept({ userId: 3, requestId: 7 });
    expect(service.accept).toHaveBeenCalledWith({ userId: 3, requestId: 7 });
  });

  it('friends.reject propagates ConflictException (filter maps to Rpc(409))', async () => {
    service.reject.mockRejectedValue(new ConflictException('friend request is not pending'));
    await expect(controller.reject({ userId: 3, requestId: 7 })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  // ---------------------------------------------------------------------------
  // remove
  // ---------------------------------------------------------------------------

  it('friends.remove forwards payload to service.remove', async () => {
    service.remove.mockResolvedValue({ ok: true });
    await controller.remove({ userId: 3, otherUserId: 4 });
    expect(service.remove).toHaveBeenCalledWith({ userId: 3, otherUserId: 4 });
  });

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------

  it('friends.list forwards payload to service.list', async () => {
    const rows = [{ id: 1, friendId: 4, acceptedAt: new Date() }];
    service.list.mockResolvedValue(rows as any);
    const out = await controller.list({ userId: 3 });
    expect(service.list).toHaveBeenCalledWith({ userId: 3 });
    expect(out).toBe(rows);
  });

  // ---------------------------------------------------------------------------
  // listPending
  // ---------------------------------------------------------------------------

  it('friends.listPending forwards payload to service.listPending', async () => {
    const rows = [
      {
        id: 2,
        requesterId: 5,
        otherUserId: 5,
        incoming: true,
        requestText: null,
        createdAt: new Date(),
      },
    ];
    service.listPending.mockResolvedValue(rows as any);
    const out = await controller.listPending({ userId: 3 });
    expect(service.listPending).toHaveBeenCalledWith({ userId: 3 });
    expect(out).toBe(rows);
  });

  // ---------------------------------------------------------------------------
  // Tolerates the `_sys` shared-secret envelope key.
  // ---------------------------------------------------------------------------

  it('tolerates an extra `_sys` key on list payload', async () => {
    service.list.mockResolvedValue([] as any);
    await controller.list({ userId: 3, _sys: 'secret' } as any);
    expect(service.list).toHaveBeenCalledWith({ userId: 3 });
  });
});
