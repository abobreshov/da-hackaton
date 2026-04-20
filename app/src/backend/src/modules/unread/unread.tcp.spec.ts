/**
 * TCP-layer tests for `UnreadTcpController` — routing only. Global
 * RpcExceptionFilter handles HttpException→RpcException at the transport
 * layer, so we just assert the handlers delegate with the right shape.
 */

import { BadRequestException } from '@nestjs/common';
import { TcpCmd } from '@app/contracts';
import { UnreadTcpController } from './unread.tcp';
import { UnreadService } from './unread.service';
import { MessagesService } from '../messages/messages.service';

function makeService(): jest.Mocked<UnreadService> {
  return {
    markRead: jest.fn(),
    getUnreadCounts: jest.fn(),
    countSince: jest.fn(),
  } as unknown as jest.Mocked<UnreadService>;
}

function makeMessagesService(): jest.Mocked<Pick<MessagesService, 'resolveDmChannelId'>> {
  return {
    resolveDmChannelId: jest.fn(),
  } as unknown as jest.Mocked<Pick<MessagesService, 'resolveDmChannelId'>>;
}

describe('UnreadTcpController', () => {
  let service: jest.Mocked<UnreadService>;
  let messages: jest.Mocked<Pick<MessagesService, 'resolveDmChannelId'>>;
  let controller: UnreadTcpController;

  beforeEach(() => {
    service = makeService();
    messages = makeMessagesService();
    controller = new UnreadTcpController(service, messages as unknown as MessagesService);
  });

  it('exposes a @MessagePattern for every unread.* TcpCmd', () => {
    const expected = new Set<string>(Object.values(TcpCmd.unread));
    const proto = Object.getPrototypeOf(controller);
    const methods = Object.getOwnPropertyNames(proto).filter((m) => m !== 'constructor');

    const seen = new Set<string>();
    for (const m of methods) {
      const raw = Reflect.getMetadata('microservices:pattern', proto[m]);
      if (!raw) continue;
      const patterns: unknown[] = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? ([] as unknown[]).concat(JSON.parse(raw))
          : [raw];
      for (const p of patterns) {
        if (typeof p === 'string') seen.add(p);
        else if (p && typeof (p as { cmd?: unknown }).cmd === 'string') {
          seen.add((p as { cmd: string }).cmd);
        }
      }
    }
    expect(seen).toEqual(expected);
  });

  it('unread.markRead forwards payload and returns { ok: true }', async () => {
    service.markRead.mockResolvedValue(undefined as unknown as void);
    const out = await controller.markRead({
      userId: 7,
      roomId: 3,
      lastReadId: 100n,
    });
    expect(service.markRead).toHaveBeenCalledWith({
      userId: 7,
      roomId: 3,
      dmId: undefined,
      lastReadId: 100n,
    });
    expect(out).toEqual({ ok: true });
  });

  it('unread.markRead tolerates `_sys` and forwards only domain fields', async () => {
    service.markRead.mockResolvedValue(undefined as unknown as void);
    await controller.markRead({
      userId: 1,
      dmId: 2,
      lastReadId: 50n,
      _sys: 'secret',
    } as any);
    expect(service.markRead).toHaveBeenCalledWith({
      userId: 1,
      roomId: undefined,
      dmId: 2,
      lastReadId: 50n,
    });
  });

  it('unread.markRead bubbles BadRequestException unchanged', async () => {
    service.markRead.mockRejectedValue(new BadRequestException('bad scope'));
    await expect(controller.markRead({ userId: 1, lastReadId: 0n } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('unread.getForUser forwards userId and returns service result', async () => {
    service.getUnreadCounts.mockResolvedValue({
      rooms: [{ roomId: 1, count: 3 }],
      dms: [],
    });
    const out = await controller.getForUser({ userId: 42 });
    expect(service.getUnreadCounts).toHaveBeenCalledWith({ userId: 42 });
    expect(out).toEqual({ rooms: [{ roomId: 1, count: 3 }], dms: [] });
  });

  it('unread.countSince forwards payload and returns { count }', async () => {
    service.countSince.mockResolvedValue(5);
    const out = await controller.countSince({ userId: 7, roomId: 3 });
    expect(service.countSince).toHaveBeenCalledWith({
      userId: 7,
      roomId: 3,
      dmId: undefined,
    });
    expect(out).toEqual({ count: 5 });
  });

  it('unread.countSince handles dm scope', async () => {
    service.countSince.mockResolvedValue(2);
    const out = await controller.countSince({ userId: 7, dmId: 11 });
    expect(service.countSince).toHaveBeenCalledWith({
      userId: 7,
      roomId: undefined,
      dmId: 11,
    });
    expect(out).toEqual({ count: 2 });
  });

  describe('markRead dmUserId → dmId resolution', () => {
    it('resolves dmUserId to dmId and forwards with dmId', async () => {
      messages.resolveDmChannelId.mockResolvedValue(42);
      service.markRead.mockResolvedValue(undefined as unknown as void);

      const out = await controller.markRead({
        userId: 7,
        dmUserId: 99,
        lastReadId: 100n,
      } as any);

      expect(messages.resolveDmChannelId).toHaveBeenCalledWith(7, 99);
      expect(service.markRead).toHaveBeenCalledWith({
        userId: 7,
        roomId: undefined,
        dmId: 42,
        lastReadId: 100n,
      });
      expect(out).toEqual({ ok: true });
    });

    it('returns { ok: true } no-op when dm channel does not exist yet', async () => {
      messages.resolveDmChannelId.mockResolvedValue(null);

      const out = await controller.markRead({
        userId: 7,
        dmUserId: 99,
        lastReadId: 100n,
      } as any);

      expect(service.markRead).not.toHaveBeenCalled();
      expect(out).toEqual({ ok: true });
    });

    it('prefers explicit dmId over dmUserId when both are present', async () => {
      service.markRead.mockResolvedValue(undefined as unknown as void);

      await controller.markRead({
        userId: 7,
        dmId: 5,
        dmUserId: 99,
        lastReadId: 100n,
      } as any);

      expect(messages.resolveDmChannelId).not.toHaveBeenCalled();
      expect(service.markRead).toHaveBeenCalledWith({
        userId: 7,
        roomId: undefined,
        dmId: 5,
        lastReadId: 100n,
      });
    });
  });
});
