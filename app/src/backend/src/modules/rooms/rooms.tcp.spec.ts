/**
 * TCP-layer tests: `RoomsTcpController` dispatches payloads to the service and
 * wraps HttpException-kind failures via `toRpc` into RpcException envelopes
 * consumable by the BFF's RpcErrorInterceptor.
 */

import { ConflictException, ForbiddenException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
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

  it('rooms.join wraps ForbiddenException as RpcException(403)', async () => {
    service.join.mockRejectedValue(new ForbiddenException('no entry'));
    await expect(controller.join({ userId: 1, roomId: 9 })).rejects.toMatchObject({
      constructor: RpcException,
    });
    // Call again to inspect the RpcException envelope.
    service.join.mockRejectedValue(new ForbiddenException('no entry'));
    try {
      await controller.join({ userId: 1, roomId: 9 });
      fail('expected RpcException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcException);
      expect(e.getError()).toMatchObject({ status: 403, message: 'no entry' });
    }
  });

  it('rooms.invite wraps ConflictException as RpcException(409)', async () => {
    service.invite.mockRejectedValue(new ConflictException('dup'));
    try {
      await controller.invite({ inviterId: 1, inviteeId: 2, roomId: 3 });
      fail('expected RpcException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcException);
      expect(e.getError()).toMatchObject({ status: 409, message: 'dup' });
    }
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
});
