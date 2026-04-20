/**
 * ReportsController (BFF) — thin delegation to ReportsService.
 *
 *   - class-level SessionGuard (unauth cannot file reports)
 *   - AC-14-13: POST /reports carries a per-user Throttle bucket
 *     (report-create, 10/hr, fail-open)
 */
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

import 'reflect-metadata';
import { RpcException } from '@nestjs/microservices';
import { ReportsController } from './reports.controller';
import { THROTTLE_METADATA_KEY, ThrottleOptions } from '../../common/decorators/throttle.decorator';

function makeServiceMock() {
  return {
    create: jest.fn(),
    list: jest.fn(),
    resolve: jest.fn(),
    dismiss: jest.fn(),
  };
}

function sessionReq(userId: number) {
  return {
    session: { sub: `u:${userId}`, email: 'u@x', name: 'u', type: 'user', scopes: [] },
  } as any;
}

describe('ReportsController (BFF) — POST /reports', () => {
  let svc: ReturnType<typeof makeServiceMock>;
  let controller: ReportsController;

  beforeEach(() => {
    svc = makeServiceMock();
    controller = new ReportsController(svc as any);
  });

  it('delegates to service.create with reporterId from session + body', async () => {
    svc.create.mockResolvedValue({ id: 'r-1', status: 'pending' });

    const res = await controller.create(
      { targetType: 'user', targetId: '42', reason: 'spam' } as any,
      sessionReq(1),
    );

    expect(svc.create).toHaveBeenCalledWith({
      reporterId: 1,
      targetType: 'user',
      targetId: '42',
      reason: 'spam',
    });
    expect(res).toEqual({ id: 'r-1', status: 'pending' });
  });

  it('propagates RpcException from upstream', async () => {
    const rpc = new RpcException({ status: 404, message: 'target missing' });
    svc.create.mockRejectedValue(rpc);
    await expect(
      controller.create({ targetType: 'user', targetId: '1', reason: 'x' } as any, sessionReq(1)),
    ).rejects.toBe(rpc);
  });
});

describe('ReportsController — guard wiring + throttle metadata', () => {
  it('class-level metadata includes SessionGuard', () => {
    const { SessionGuard } = require('../../auth/session.guard');
    const guards = Reflect.getMetadata('__guards__', ReportsController) ?? [];
    expect(guards).toEqual(expect.arrayContaining([SessionGuard]));
  });

  // AC-14-13 — POST /reports: 10/hr per userId, fail-open.
  it('POST /reports carries a throttle bucket {scope:report-create, limit:10, windowMs:3_600_000, failClosed:false}', () => {
    const meta = Reflect.getMetadata(THROTTLE_METADATA_KEY, ReportsController.prototype.create) as
      | ThrottleOptions[]
      | undefined;

    expect(Array.isArray(meta)).toBe(true);
    const bucket = (meta ?? []).find((m) => m.scope === 'report-create');
    expect(bucket).toBeDefined();
    expect(bucket!.limit).toBe(10);
    expect(bucket!.windowMs).toBe(3_600_000);
    expect(bucket!.failClosed).toBe(false);
    expect(typeof bucket!.keyFn).toBe('function');

    const key = bucket!.keyFn!({ session: { sub: 'u:42' } } as any);
    expect(key).toBe('u:42');
  });
});
