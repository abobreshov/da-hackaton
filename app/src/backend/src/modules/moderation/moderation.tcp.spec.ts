/**
 * TCP-layer tests: `ModerationTcpController` dispatches payloads to the
 * service and wraps HttpException-kind failures via `toRpc` into
 * RpcException envelopes consumable by the BFF's RpcErrorInterceptor.
 *
 * Fills the M2 blocker where `ModerationModule` exposed only HTTP — the
 * BFF had no TCP entry for promote/demote/ban/unban/listBans/deleteRoom.
 */

// Must come before the ModerationService import below — the service pulls
// in `database/connection` which evaluates the env schema at import time.
jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { ModerationTcpController } from './moderation.tcp';
import { ModerationService } from './moderation.service';

function makeService(): jest.Mocked<ModerationService> {
  return {
    promote: jest.fn(),
    demote: jest.fn(),
    banMember: jest.fn(),
    unbanMember: jest.fn(),
    listBans: jest.fn(),
    deleteRoom: jest.fn(),
  } as unknown as jest.Mocked<ModerationService>;
}

describe('ModerationTcpController', () => {
  let service: jest.Mocked<ModerationService>;
  let controller: ModerationTcpController;

  beforeEach(() => {
    service = makeService();
    controller = new ModerationTcpController(service);
  });

  // ---------------------------------------------------------------------------
  // Wiring: every service method is reachable via a TCP @MessagePattern.
  // ---------------------------------------------------------------------------

  it('exposes exactly one @MessagePattern per moderation action with expected cmd strings', () => {
    const expected = new Set<string>([
      'rooms.members.promote',
      'rooms.members.demote',
      'rooms.members.ban',
      'rooms.bans.unban',
      'rooms.bans.list',
      'rooms.delete',
    ]);

    const proto = Object.getPrototypeOf(controller);
    const methods = Object.getOwnPropertyNames(proto).filter((m) => m !== 'constructor');

    const seenCmds = new Set<string>();
    for (const m of methods) {
      const raw = Reflect.getMetadata('microservices:pattern', proto[m]);
      if (!raw) continue;
      // Nest stores the pattern as a JSON-serialised string (array of pattern
      // objects when using @MessagePattern). Support both raw object form and
      // the stringified envelope Nest 11 produces.
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
  // promote
  // ---------------------------------------------------------------------------

  it('rooms.members.promote forwards payload to service.promote', async () => {
    service.promote.mockResolvedValue(undefined);
    await controller.promote({ roomId: 1, actorId: 2, userId: 3 });
    expect(service.promote).toHaveBeenCalledWith({
      roomId: 1,
      actorId: 2,
      userId: 3,
    });
  });

  it('rooms.members.promote wraps ForbiddenException as RpcException(403)', async () => {
    service.promote.mockRejectedValue(new ForbiddenException('owner required'));
    try {
      await controller.promote({ roomId: 1, actorId: 2, userId: 3 });
      fail('expected RpcException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcException);
      expect(e.getError()).toMatchObject({ status: 403, message: 'owner required' });
    }
  });

  // ---------------------------------------------------------------------------
  // demote
  // ---------------------------------------------------------------------------

  it('rooms.members.demote forwards payload to service.demote', async () => {
    service.demote.mockResolvedValue(undefined);
    await controller.demote({ roomId: 10, actorId: 20, userId: 30 });
    expect(service.demote).toHaveBeenCalledWith({
      roomId: 10,
      actorId: 20,
      userId: 30,
    });
  });

  // ---------------------------------------------------------------------------
  // ban / unban
  // ---------------------------------------------------------------------------

  it('rooms.members.ban maps actorId -> adminId on service.banMember', async () => {
    service.banMember.mockResolvedValue(undefined);
    await controller.banMember({ roomId: 5, actorId: 6, userId: 7 });
    expect(service.banMember).toHaveBeenCalledWith({
      roomId: 5,
      adminId: 6,
      userId: 7,
    });
  });

  it('rooms.members.ban wraps NotFoundException as RpcException(404)', async () => {
    service.banMember.mockRejectedValue(new NotFoundException('not a member'));
    try {
      await controller.banMember({ roomId: 5, actorId: 6, userId: 7 });
      fail('expected RpcException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcException);
      expect(e.getError()).toMatchObject({ status: 404, message: 'not a member' });
    }
  });

  it('rooms.bans.unban maps actorId -> adminId on service.unbanMember', async () => {
    service.unbanMember.mockResolvedValue(undefined);
    await controller.unbanMember({ roomId: 5, actorId: 6, userId: 7 });
    expect(service.unbanMember).toHaveBeenCalledWith({
      roomId: 5,
      adminId: 6,
      userId: 7,
    });
  });

  // ---------------------------------------------------------------------------
  // listBans
  // ---------------------------------------------------------------------------

  it('rooms.bans.list maps actorId -> viewerId and returns service result', async () => {
    const rows = [{ userId: 9, bannedBy: 1, bannedAt: new Date() }];
    service.listBans.mockResolvedValue(rows as any);
    const out = await controller.listBans({ roomId: 42, actorId: 1 });
    expect(service.listBans).toHaveBeenCalledWith({ roomId: 42, viewerId: 1 });
    expect(out).toBe(rows);
  });

  // ---------------------------------------------------------------------------
  // deleteRoom
  // ---------------------------------------------------------------------------

  it('rooms.delete forwards payload to service.deleteRoom', async () => {
    service.deleteRoom.mockResolvedValue(undefined);
    await controller.deleteRoom({ roomId: 99, actorId: 1 });
    expect(service.deleteRoom).toHaveBeenCalledWith({ roomId: 99, actorId: 1 });
  });

  it('rooms.delete wraps ForbiddenException as RpcException(403)', async () => {
    service.deleteRoom.mockRejectedValue(new ForbiddenException('owner required'));
    try {
      await controller.deleteRoom({ roomId: 99, actorId: 1 });
      fail('expected RpcException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcException);
      expect(e.getError()).toMatchObject({ status: 403, message: 'owner required' });
    }
  });

  // ---------------------------------------------------------------------------
  // Ignores the `_sys` shared-secret envelope key (stripped by guard upstream
  // but controllers should still accept objects that happen to include it).
  // ---------------------------------------------------------------------------

  it('tolerates an extra `_sys` key on the payload', async () => {
    service.promote.mockResolvedValue(undefined);
    await controller.promote({ roomId: 1, actorId: 2, userId: 3, _sys: 'secret' } as any);
    expect(service.promote).toHaveBeenCalledWith({ roomId: 1, actorId: 2, userId: 3 });
  });
});
