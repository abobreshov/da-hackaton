/**
 * TCP-layer tests: `RoomsTcpController` dispatches payloads to the service.
 *
 * HttpException -> RpcException translation is done by the global
 * `RpcExceptionFilter` (see `common/rpc/rpc-exception.filter.spec.ts`), not
 * the controller, so these tests assert raw HttpException propagation from
 * the service through the thin controller layer.
 */

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RoomsTcpController } from './rooms.tcp';
import { RoomsService } from './rooms.service';

function makeService(): jest.Mocked<RoomsService> {
  return {
    create: jest.fn(),
    catalog: jest.fn(),
    listMy: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    invite: jest.fn(),
    membersOf: jest.fn(),
    ensureMember: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<RoomsService>;
}

describe('RoomsTcpController', () => {
  let service: jest.Mocked<RoomsService>;
  let controller: RoomsTcpController;

  beforeEach(() => {
    service = makeService();
    controller = new RoomsTcpController(service);
  });

  it('rooms.create forwards payload', async () => {
    service.create.mockResolvedValue({ id: 1 } as any);
    const out = await controller.create({
      ownerId: 1,
      name: 'x',
      visibility: 'public',
    });
    expect(service.create).toHaveBeenCalledWith({
      ownerId: 1,
      name: 'x',
      visibility: 'public',
    });
    expect(out).toEqual({ id: 1 });
  });

  it('rooms.leave returns { ok: true } and passes payload through', async () => {
    service.leave.mockResolvedValue(undefined);
    await expect(controller.leave({ userId: 1, roomId: 2 })).resolves.toEqual({ ok: true });
  });

  it('rooms.join propagates ForbiddenException (filter maps to Rpc(403))', async () => {
    service.join.mockRejectedValue(new ForbiddenException('no entry'));
    await expect(controller.join({ userId: 1, roomId: 9 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rooms.invite propagates ConflictException (filter maps to Rpc(409))', async () => {
    service.invite.mockRejectedValue(new ConflictException('dup'));
    await expect(
      controller.invite({ inviterId: 1, inviteeId: 2, roomId: 3 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rooms.catalog forwards service result', async () => {
    service.catalog.mockResolvedValue([{ id: 1 }, { id: 2 }] as any);
    await expect(controller.catalog()).resolves.toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('rooms.listMy passes userId', async () => {
    service.listMy.mockResolvedValue([] as any);
    await controller.listMy({ userId: 7 });
    expect(service.listMy).toHaveBeenCalledWith(7);
  });

  it('rooms.membersOf forwards roomId and returns service result', async () => {
    const payload = {
      members: [{ userId: 1, role: 'owner', username: 'alice' }],
    };
    service.membersOf.mockResolvedValue(payload as any);
    await expect(controller.membersOf({ roomId: 42 })).resolves.toEqual(payload);
    expect(service.membersOf).toHaveBeenCalledWith(42);
  });

  it('rooms.membersOf propagates NotFoundException (filter maps to Rpc(404))', async () => {
    service.membersOf.mockRejectedValue(new NotFoundException('room gone'));
    await expect(controller.membersOf({ roomId: 42 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rooms.ensureMember forwards payload and returns { ok: true }', async () => {
    service.ensureMember.mockResolvedValue({ ok: true });
    await expect(controller.ensureMember({ roomId: 3, userId: 7 })).resolves.toEqual({ ok: true });
    expect(service.ensureMember).toHaveBeenCalledWith({ roomId: 3, userId: 7 });
  });

  it('rooms.ensureMember propagates ForbiddenException (filter maps to Rpc(403))', async () => {
    service.ensureMember.mockRejectedValue(new ForbiddenException('not a member'));
    await expect(controller.ensureMember({ roomId: 3, userId: 7 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rooms.ensureMember propagates NotFoundException (filter maps to Rpc(404))', async () => {
    service.ensureMember.mockRejectedValue(new NotFoundException('room missing'));
    await expect(controller.ensureMember({ roomId: 3, userId: 7 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // ---------------------------------------------------------------------------
  // rooms.update (EPIC-05 AC-05-13)
  // ---------------------------------------------------------------------------

  it('rooms.update forwards payload into service.update', async () => {
    service.update.mockResolvedValue({ id: 1, name: 'new' } as any);
    const patch = { name: 'new', visibility: 'private' as const };
    const out = await controller.update({ roomId: 1, actorId: 7, patch });
    expect(service.update).toHaveBeenCalledWith({
      roomId: 1,
      actorId: 7,
      patch,
    });
    expect(out).toEqual({ id: 1, name: 'new' });
  });

  it('rooms.update propagates ConflictException for duplicate name (filter → Rpc(409))', async () => {
    const { ConflictException: C } = require('@nestjs/common');
    service.update.mockRejectedValue(new C('dup'));
    await expect(
      controller.update({ roomId: 1, actorId: 7, patch: { name: 'x' } }),
    ).rejects.toBeInstanceOf(C);
  });

  it('rooms.update propagates ForbiddenException for non-owner (filter → Rpc(403))', async () => {
    const { ForbiddenException: F } = require('@nestjs/common');
    service.update.mockRejectedValue(new F('not owner'));
    await expect(
      controller.update({ roomId: 1, actorId: 7, patch: { name: 'x' } }),
    ).rejects.toBeInstanceOf(F);
  });

  it('rooms.update tolerates missing `patch` (treats as empty)', async () => {
    service.update.mockResolvedValue({ id: 1 } as any);
    await controller.update({ roomId: 1, actorId: 7 } as any);
    expect(service.update).toHaveBeenCalledWith({
      roomId: 1,
      actorId: 7,
      patch: {},
    });
  });
});
