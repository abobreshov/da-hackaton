/**
 * TCP-layer tests: `MessagesTcpController` dispatches payloads to the service.
 *
 * Exception translation (HttpException -> RpcException) is handled GLOBALLY
 * by `RpcExceptionFilter` (registered in `src/microservice.ts`), not per
 * handler — so these unit tests assert the service is invoked with the right
 * shape and that errors thrown by the service bubble up unchanged. The
 * wire-level wrapping is exercised by `common/rpc/rpc-exception.filter.spec.ts`.
 */

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { ErrorCode, TcpCmd } from '@app/contracts';
import { MessagesTcpController } from './messages.tcp';
import { MessagesService } from './messages.service';

function makeService(): jest.Mocked<MessagesService> {
  return {
    create: jest.fn(),
    edit: jest.fn(),
    delete: jest.fn(),
    list: jest.fn(),
    since: jest.fn(),
    getById: jest.fn(),
    resolveDmChannelId: jest.fn(),
  } as unknown as jest.Mocked<MessagesService>;
}

describe('MessagesTcpController', () => {
  let service: jest.Mocked<MessagesService>;
  let controller: MessagesTcpController;

  beforeEach(() => {
    service = makeService();
    controller = new MessagesTcpController(service);
  });

  // ---------------------------------------------------------------------------
  // Wiring: every service method is reachable via a TCP @MessagePattern with
  // the contract string we just added to @app/contracts.
  // ---------------------------------------------------------------------------

  it('exposes a @MessagePattern for every messages.* TcpCmd', () => {
    const expected = new Set<string>(Object.values(TcpCmd.messages));

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

  it('messages.create forwards payload and returns service result', async () => {
    service.create.mockResolvedValue({ message: { id: 1n, body: 'hi' } } as any);
    const out = await controller.create({ authorId: 7, roomId: 3, body: 'hi' });
    expect(service.create).toHaveBeenCalledWith({
      authorId: 7,
      roomId: 3,
      dmUserId: undefined,
      body: 'hi',
      replyToId: undefined,
    });
    expect(out).toEqual({ message: { id: 1n, body: 'hi' } });
  });

  it('messages.create lets BadRequestException bubble to the global filter', async () => {
    service.create.mockRejectedValue(new BadRequestException('too big'));
    await expect(
      controller.create({ authorId: 7, roomId: 3, body: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('messages.create preserves a DM_FROZEN WireError HttpException(403)', async () => {
    const wire = new HttpException({ code: ErrorCode.DM_FROZEN, message: 'frozen' }, 403);
    service.create.mockRejectedValue(wire);
    await expect(
      controller.create({ authorId: 7, dmUserId: 9, body: 'hi' }),
    ).rejects.toBe(wire);
  });

  it('messages.create tolerates `_sys` and forwards only domain fields', async () => {
    service.create.mockResolvedValue({ message: {} } as any);
    await controller.create({
      authorId: 1,
      roomId: 2,
      body: 'ok',
      _sys: 'secret',
    } as any);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: 1, roomId: 2, body: 'ok' }),
    );
  });

  it('messages.edit forwards payload', async () => {
    service.edit.mockResolvedValue({ message: { id: 1n } } as any);
    const out = await controller.edit({ id: 1n, actorId: 7, body: 'fixed' });
    expect(service.edit).toHaveBeenCalledWith({ id: 1n, actorId: 7, body: 'fixed' });
    expect(out).toEqual({ message: { id: 1n } });
  });

  it('messages.edit bubbles ForbiddenException unchanged', async () => {
    service.edit.mockRejectedValue(new ForbiddenException('not yours'));
    await expect(
      controller.edit({ id: 1n, actorId: 99, body: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('messages.delete forwards payload and returns { ok: true }', async () => {
    service.delete.mockResolvedValue(undefined as any);
    await expect(
      controller.delete({ id: 1n, actorId: 7, isRoomAdmin: false }),
    ).resolves.toEqual({ ok: true });
    expect(service.delete).toHaveBeenCalledWith({ id: 1n, actorId: 7, isRoomAdmin: false });
  });

  it('messages.delete bubbles NotFoundException unchanged', async () => {
    service.delete.mockRejectedValue(new NotFoundException('gone'));
    await expect(
      controller.delete({ id: 1n, actorId: 7, isRoomAdmin: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('messages.list forwards payload', async () => {
    service.list.mockResolvedValue({ messages: [] } as any);
    await controller.list({ roomId: 3, limit: 50 });
    expect(service.list).toHaveBeenCalledWith({
      roomId: 3,
      dmId: undefined,
      before: undefined,
      limit: 50,
    });
  });

  it('messages.list forwards composite cursor', async () => {
    service.list.mockResolvedValue({ messages: [] } as any);
    const ts = new Date(Date.UTC(2026, 0, 1));
    await controller.list({ roomId: 3, before: { createdAt: ts, id: 42n }, limit: 50 });
    expect(service.list).toHaveBeenCalledWith({
      roomId: 3,
      dmId: undefined,
      before: { createdAt: ts, id: 42n },
      limit: 50,
    });
  });

  it('messages.since forwards payload', async () => {
    service.since.mockResolvedValue({ messages: [] } as any);
    await controller.since({ roomId: 3, lastSeenId: 10n, limit: 50 });
    expect(service.since).toHaveBeenCalledWith({
      roomId: 3,
      dmId: undefined,
      lastSeenId: 10n,
      limit: 50,
    });
  });

  it('messages.getById forwards id and returns service result', async () => {
    service.getById.mockResolvedValue({ message: { id: 7n } } as any);
    const out = await controller.getById({ id: 7n });
    expect(service.getById).toHaveBeenCalledWith(7n);
    expect(out).toEqual({ message: { id: 7n } });
  });
});
