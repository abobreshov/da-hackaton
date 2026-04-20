/**
 * QueueProducer is a thin DI-injected wrapper around `Queue.add(...)`.
 * Tests verify each enqueue* helper passes the correct (jobName, payload).
 */

import { QueueProducer } from './queue.producer';

function fakeQueue() {
  return { add: jest.fn(async (jobName: string, data: any) => ({ id: `${jobName}-1`, data })) };
}

describe('QueueProducer', () => {
  let cascade: ReturnType<typeof fakeQueue>;
  let retention: ReturnType<typeof fakeQueue>;
  let cleanup: ReturnType<typeof fakeQueue>;
  let abuse: ReturnType<typeof fakeQueue>;
  let producer: QueueProducer;

  beforeEach(() => {
    cascade = fakeQueue();
    retention = fakeQueue();
    cleanup = fakeQueue();
    abuse = fakeQueue();
    producer = new QueueProducer(cascade as any, retention as any, cleanup as any, abuse as any);
  });

  it('enqueueUserCascadeDelete passes (jobName, { userId })', async () => {
    await producer.enqueueUserCascadeDelete('u-42');
    expect(cascade.add).toHaveBeenCalledWith('user.cascade.delete', { userId: 'u-42' });
  });

  it('enqueueRetentionPrune defaults runId to a numeric epoch when omitted', async () => {
    await producer.enqueueRetentionPrune();
    const [name, payload] = retention.add.mock.calls[0];
    expect(name).toBe('retention.prune');
    expect(typeof payload.runId).toBe('number');
  });

  it('enqueueRetentionPrune accepts a caller-supplied runId', async () => {
    await producer.enqueueRetentionPrune('manual-2026-04-20');
    expect(retention.add).toHaveBeenCalledWith('retention.prune', {
      runId: 'manual-2026-04-20',
    });
  });

  it('enqueueAttachmentsCleanup with id', async () => {
    await producer.enqueueAttachmentsCleanup('att-1');
    expect(cleanup.add).toHaveBeenCalledWith('attachments.cleanup', {
      attachmentId: 'att-1',
    });
  });

  it('enqueueAttachmentsCleanup as sweep (no id) sets attachmentId=undefined', async () => {
    await producer.enqueueAttachmentsCleanup();
    expect(cleanup.add).toHaveBeenCalledWith('attachments.cleanup', {
      attachmentId: undefined,
    });
  });

  it('enqueueAbuseReportNotify passes the report id', async () => {
    await producer.enqueueAbuseReportNotify('rep-9');
    expect(abuse.add).toHaveBeenCalledWith('abuse.report.notify', { reportId: 'rep-9' });
  });

  it('returns whatever the underlying queue.add resolves to', async () => {
    cascade.add = jest.fn(async (jobName: string, _data: any) => ({
      id: 'custom-id',
      data: _data,
    })) as any;
    const out = await producer.enqueueUserCascadeDelete('u-1');
    expect(out).toMatchObject({ id: 'custom-id' });
  });
});
