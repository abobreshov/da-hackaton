jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

/**
 * Backend MessagesController — focused regression coverage.
 *
 * Scope: cursor-validity guard for `?before=` (CodeRabbit N4). Previously the
 * controller did `new Date(before)` and passed an `Invalid Date` straight to
 * the SQL layer, where it became `NaN` and silently broke pagination. Now we
 * fail fast with 400.
 *
 * Service / RoomsService are mocked: this spec exercises the controller's
 * input validation, not the underlying query path.
 */
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import {
  RoomMessagesController,
  DmMessagesController,
} from './messages.controller';

function makeMessagesService() {
  return {
    list: jest.fn().mockResolvedValue({ messages: [] }),
    resolveDmChannelId: jest.fn().mockResolvedValue(99n),
  };
}

function makeRoomsService() {
  return {
    ensureMember: jest.fn().mockResolvedValue(undefined),
  };
}

const authedReq = (id: number) => ({ user: { id } } as any);

describe('RoomMessagesController — `?before=` cursor validity (CR N4)', () => {
  let svc: ReturnType<typeof makeMessagesService>;
  let rooms: ReturnType<typeof makeRoomsService>;
  let controller: RoomMessagesController;

  beforeEach(() => {
    svc = makeMessagesService();
    rooms = makeRoomsService();
    controller = new RoomMessagesController(svc as any, rooms as any);
  });

  it('rejects garbage `?before=foo` with BadRequestException (400)', async () => {
    await expect(
      controller.list(5, 'foo', '10', undefined, authedReq(1)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.list).not.toHaveBeenCalled();
  });

  it('rejects an empty-but-truthy malformed string', async () => {
    await expect(
      controller.list(5, 'not-a-date', '10', undefined, authedReq(1)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a valid ISO-8601 timestamp and forwards Date to the service', async () => {
    await controller.list(5, '2026-04-20T10:00:00Z', '10', undefined, authedReq(1));
    const callArg = svc.list.mock.calls[0][0];
    expect(callArg.before.createdAt).toBeInstanceOf(Date);
    expect(callArg.before.createdAt.toISOString()).toBe('2026-04-20T10:00:00.000Z');
    expect(callArg.before.id).toBe(10n);
  });

  it('passes through `undefined` cursor when `?before=` is omitted', async () => {
    await controller.list(5, undefined, undefined, undefined, authedReq(1));
    expect(svc.list.mock.calls[0][0].before).toBeUndefined();
  });
});

describe('DmMessagesController — `?before=` cursor validity (CR N4)', () => {
  let svc: ReturnType<typeof makeMessagesService>;
  let controller: DmMessagesController;

  beforeEach(() => {
    svc = makeMessagesService();
    controller = new DmMessagesController(svc as any);
  });

  it('rejects garbage `?before=` with BadRequestException', async () => {
    await expect(
      controller.list(2, 'totally-not-iso', '10', undefined, authedReq(1)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.list).not.toHaveBeenCalled();
  });

  it('accepts a valid ISO-8601 timestamp and forwards Date', async () => {
    await controller.list(2, '2026-01-02T03:04:05Z', '10', undefined, authedReq(1));
    const callArg = svc.list.mock.calls[0][0];
    expect(callArg.before.createdAt).toBeInstanceOf(Date);
    expect(callArg.before.createdAt.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });
});
