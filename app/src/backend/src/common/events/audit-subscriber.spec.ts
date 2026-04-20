/**
 * Tests `AuditSubscriber` — the EPIC-06 indirection between domain events
 * and the audit log. Producers (ModerationService, AbuseReportsService)
 * emit `room.*` / `report.*` events via `IEventPublisher`; this subscriber
 * registers handlers via `IEventPublisher.on(...)` at app bootstrap and
 * forwards each into `AuditService.append(...)` with the right shape.
 *
 * The whole point of the subscriber is that the producer services no
 * longer call `audit.append` themselves — these tests therefore lock in
 * the mapping table from event-name → audit row shape so a future regress
 * (forgotten event, wrong target type, lost roomId metadata) is caught.
 */

jest.mock('../../config/environment', () => ({
  env: { DATABASE_URL: 'postgres://test', SYSTEM_KEY: 'x'.repeat(32), TLS_ENABLED: false },
}));
jest.mock('../../database/connection', () => ({
  db: {},
  pool: { end: () => Promise.resolve() },
}));

import { LoggingEventPublisher } from './event-publisher';
import { AuditSubscriber } from './audit-subscriber.service';
import type { AuditService, AuditAppendInput } from '../../modules/audit/audit.service';

function makeAudit(): jest.Mocked<AuditService> {
  return {
    append: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;
}

/** Synchronously flush the in-process EventEmitter so async handlers settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('AuditSubscriber', () => {
  it('registers handlers for every EPIC-06 event on bootstrap', () => {
    const pub = new LoggingEventPublisher();
    const onSpy = jest.spyOn(pub, 'on');
    const audit = makeAudit();
    const sub = new AuditSubscriber(pub, audit);

    sub.onApplicationBootstrap();

    const expected = new Set<string>([
      'room.ban',
      'room.unban',
      'room.role.promote',
      'room.role.demote',
      'room.delete',
      'report.create',
      'report.resolve',
      'report.dismiss',
    ]);

    const seen = new Set<string>(onSpy.mock.calls.map((c) => c[0] as string));
    expect(seen).toEqual(expected);
  });

  it('room.ban -> audit.append with action=room.ban + targetType=user + roomId metadata', async () => {
    const pub = new LoggingEventPublisher();
    const audit = makeAudit();
    new AuditSubscriber(pub, audit).onApplicationBootstrap();

    pub.emit('room.ban', { actorId: 20, roomId: 1, userId: 30 });
    await flush();

    expect(audit.append).toHaveBeenCalledWith({
      actorId: 20,
      actorType: 'admin',
      action: 'room.ban',
      targetType: 'user',
      targetId: 30n,
      metadata: { roomId: 1 },
    } satisfies AuditAppendInput);
  });

  it('room.unban -> audit.append with action=room.unban + targetType=user', async () => {
    const pub = new LoggingEventPublisher();
    const audit = makeAudit();
    new AuditSubscriber(pub, audit).onApplicationBootstrap();

    pub.emit('room.unban', { actorId: 20, roomId: 1, userId: 30 });
    await flush();

    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'room.unban',
        targetType: 'user',
        targetId: 30n,
        metadata: { roomId: 1 },
      }),
    );
  });

  it('room.role.promote -> audit.append with newRole=admin in metadata', async () => {
    const pub = new LoggingEventPublisher();
    const audit = makeAudit();
    new AuditSubscriber(pub, audit).onApplicationBootstrap();

    pub.emit('room.role.promote', { actorId: 10, roomId: 1, userId: 30, newRole: 'admin' });
    await flush();

    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'room.role.promote',
        targetType: 'user',
        targetId: 30n,
        metadata: { roomId: 1, newRole: 'admin' },
      }),
    );
  });

  it('room.role.demote -> audit.append with newRole=member in metadata', async () => {
    const pub = new LoggingEventPublisher();
    const audit = makeAudit();
    new AuditSubscriber(pub, audit).onApplicationBootstrap();

    pub.emit('room.role.demote', { actorId: 10, roomId: 1, userId: 20 });
    await flush();

    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'room.role.demote',
        targetType: 'user',
        targetId: 20n,
        metadata: { roomId: 1, newRole: 'member' },
      }),
    );
  });

  it('room.delete -> audit.append with targetType=room + targetId=roomId (bigint)', async () => {
    const pub = new LoggingEventPublisher();
    const audit = makeAudit();
    new AuditSubscriber(pub, audit).onApplicationBootstrap();

    pub.emit('room.delete', { actorId: 10, roomId: 7 });
    await flush();

    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 10,
        action: 'room.delete',
        targetType: 'room',
        targetId: 7n,
        metadata: { roomId: 7 },
      }),
    );
  });

  it('report.create -> audit.append (actorType=user) carrying targetType + targetId metadata', async () => {
    const pub = new LoggingEventPublisher();
    const audit = makeAudit();
    new AuditSubscriber(pub, audit).onApplicationBootstrap();

    pub.emit('report.create', {
      actorId: 2,
      reportId: 99n,
      targetType: 'message',
      targetId: 1234n,
    });
    await flush();

    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 2,
        actorType: 'user',
        action: 'report.create',
        targetType: 'abuse_report',
        targetId: 99n,
        metadata: { targetType: 'message', targetId: '1234' },
      }),
    );
  });

  it('report.resolve -> audit.append with note metadata when supplied', async () => {
    const pub = new LoggingEventPublisher();
    const audit = makeAudit();
    new AuditSubscriber(pub, audit).onApplicationBootstrap();

    pub.emit('report.resolve', { actorId: 1, reportId: 42n, note: 'handled' });
    await flush();

    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 1,
        action: 'report.resolve',
        targetType: 'abuse_report',
        targetId: 42n,
        metadata: { note: 'handled' },
      }),
    );
  });

  it('report.dismiss -> audit.append without metadata when no note', async () => {
    const pub = new LoggingEventPublisher();
    const audit = makeAudit();
    new AuditSubscriber(pub, audit).onApplicationBootstrap();

    pub.emit('report.dismiss', { actorId: 1, reportId: 8n });
    await flush();

    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'report.dismiss',
        targetType: 'abuse_report',
        targetId: 8n,
        metadata: undefined,
      }),
    );
  });

  it('does not call audit.append for unrelated events', async () => {
    const pub = new LoggingEventPublisher();
    const audit = makeAudit();
    new AuditSubscriber(pub, audit).onApplicationBootstrap();

    pub.emit('user.banned.me', { byUserId: 1, userId: 2 });
    pub.emit('friend.removed', { userId: 1, otherUserId: 2 });
    await flush();

    expect(audit.append).not.toHaveBeenCalled();
  });

  it('skips a malformed payload (missing target id) without throwing', async () => {
    const pub = new LoggingEventPublisher();
    const audit = makeAudit();
    new AuditSubscriber(pub, audit).onApplicationBootstrap();

    expect(() => pub.emit('room.ban', { actorId: 20, roomId: 1 })).not.toThrow();
    await flush();

    expect(audit.append).not.toHaveBeenCalled();
  });
});
