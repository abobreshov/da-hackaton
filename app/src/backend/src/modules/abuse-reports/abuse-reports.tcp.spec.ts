/**
 * TCP-layer AbuseReportsTcpController — @MessagePattern handlers that
 * dispatch to the service and wrap HttpException-kind failures via `toRpc`
 * into RpcException envelopes.
 */

jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

import { ForbiddenException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { AbuseReportsTcpController } from './abuse-reports.tcp';
import type { AbuseReportsService } from './abuse-reports.service';

function makeService(): jest.Mocked<AbuseReportsService> {
  return {
    create: jest.fn(),
    listOpen: jest.fn(),
    resolve: jest.fn(),
    dismiss: jest.fn(),
  } as unknown as jest.Mocked<AbuseReportsService>;
}

describe('AbuseReportsTcpController', () => {
  let service: jest.Mocked<AbuseReportsService>;
  let controller: AbuseReportsTcpController;

  beforeEach(() => {
    service = makeService();
    controller = new AbuseReportsTcpController(service);
  });

  it('exposes a @MessagePattern per reports action with expected cmd strings', () => {
    const expected = new Set<string>([
      'reports.create',
      'reports.resolve',
      'reports.dismiss',
      'reports.list',
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
  // list
  // ---------------------------------------------------------------------------

  it('reports.list forwards payload (no before cursor) to service.listOpen', async () => {
    const rows = [{ id: 1n }, { id: 2n }];
    service.listOpen.mockResolvedValue(rows as any);
    const out = await controller.list({ adminId: 9, limit: 25 });
    expect(service.listOpen).toHaveBeenCalledWith({
      adminId: 9,
      limit: 25,
      before: undefined,
    });
    expect(out).toBe(rows);
  });

  it('reports.list parses beforeCreatedAt (ISO) and beforeId (bigint-string) into cursor', async () => {
    service.listOpen.mockResolvedValue([] as any);
    await controller.list({
      adminId: 9,
      limit: 50,
      beforeCreatedAt: '2026-04-20T10:00:00.000Z',
      beforeId: '123',
    });
    expect(service.listOpen).toHaveBeenCalledWith({
      adminId: 9,
      limit: 50,
      before: {
        createdAt: new Date('2026-04-20T10:00:00.000Z'),
        id: 123n,
      },
    });
  });

  it('reports.list passes through when only one cursor field is provided (before=undefined)', async () => {
    service.listOpen.mockResolvedValue([] as any);
    await controller.list({
      adminId: 9,
      limit: 10,
      beforeCreatedAt: '2026-04-20T10:00:00.000Z',
    });
    expect(service.listOpen).toHaveBeenCalledWith({
      adminId: 9,
      limit: 10,
      before: undefined,
    });
  });

  it('reports.list wraps ForbiddenException (non-admin) as RpcException(403)', async () => {
    service.listOpen.mockRejectedValue(new ForbiddenException('admin required'));
    try {
      await controller.list({ adminId: 9, limit: 10 });
      fail('expected RpcException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcException);
      expect(e.getError()).toMatchObject({ status: 403, message: 'admin required' });
    }
  });

  // ---------------------------------------------------------------------------
  // Tolerates the `_sys` shared-secret envelope key.
  // ---------------------------------------------------------------------------

  it('tolerates an extra `_sys` key on list payload', async () => {
    service.listOpen.mockResolvedValue([] as any);
    await controller.list({ adminId: 9, limit: 5, _sys: 'secret' } as any);
    expect(service.listOpen).toHaveBeenCalledWith({
      adminId: 9,
      limit: 5,
      before: undefined,
    });
  });
});
