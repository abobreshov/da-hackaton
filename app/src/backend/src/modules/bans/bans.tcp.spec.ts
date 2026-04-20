/**
 * TCP-layer BansTcpController — @MessagePattern handlers that dispatch to
 * the service and wrap HttpException-kind failures via `toRpc` into
 * RpcException envelopes consumable by the BFF's RpcErrorInterceptor.
 */

jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

import { BadRequestException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { BansTcpController } from './bans.tcp';
import type { BansService } from './bans.service';

function makeService(): jest.Mocked<BansService> {
  return {
    banUser: jest.fn(),
    unbanUser: jest.fn(),
    isBanned: jest.fn(),
    listBansByUser: jest.fn(),
  } as unknown as jest.Mocked<BansService>;
}

describe('BansTcpController', () => {
  let service: jest.Mocked<BansService>;
  let controller: BansTcpController;

  beforeEach(() => {
    service = makeService();
    controller = new BansTcpController(service);
  });

  it('exposes a @MessagePattern per bans action with expected cmd strings', () => {
    const expected = new Set<string>([
      'users.ban',
      'users.unban',
      'users.listBans',
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
  // ban
  // ---------------------------------------------------------------------------

  it('users.ban forwards payload to service.banUser', async () => {
    service.banUser.mockResolvedValue({ ok: true });
    const out = await controller.ban({ bannerId: 3, bannedId: 4 });
    expect(service.banUser).toHaveBeenCalledWith({ bannerId: 3, bannedId: 4 });
    expect(out).toEqual({ ok: true });
  });

  it('users.ban wraps BadRequestException (self-ban) as RpcException(400)', async () => {
    service.banUser.mockRejectedValue(new BadRequestException('cannot ban yourself'));
    try {
      await controller.ban({ bannerId: 1, bannedId: 1 });
      fail('expected RpcException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcException);
      expect(e.getError()).toMatchObject({ status: 400 });
    }
  });

  // ---------------------------------------------------------------------------
  // unban
  // ---------------------------------------------------------------------------

  it('users.unban forwards payload to service.unbanUser', async () => {
    service.unbanUser.mockResolvedValue({ ok: true });
    await controller.unban({ bannerId: 3, bannedId: 4 });
    expect(service.unbanUser).toHaveBeenCalledWith({ bannerId: 3, bannedId: 4 });
  });

  // ---------------------------------------------------------------------------
  // listBans
  // ---------------------------------------------------------------------------

  it('users.listBans forwards payload to service.listBansByUser', async () => {
    const rows = [{ bannedId: 7, createdAt: new Date() }];
    service.listBansByUser.mockResolvedValue(rows as any);
    const out = await controller.listBans({ userId: 3 });
    expect(service.listBansByUser).toHaveBeenCalledWith({ userId: 3 });
    expect(out).toBe(rows);
  });

  // ---------------------------------------------------------------------------
  // Tolerates the `_sys` shared-secret envelope key.
  // ---------------------------------------------------------------------------

  it('tolerates an extra `_sys` key on listBans payload', async () => {
    service.listBansByUser.mockResolvedValue([] as any);
    await controller.listBans({ userId: 3, _sys: 'secret' } as any);
    expect(service.listBansByUser).toHaveBeenCalledWith({ userId: 3 });
  });
});
