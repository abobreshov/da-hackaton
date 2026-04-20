/**
 * Smoke tests for the four stub processors. Each is a pure function that
 * returns `{ ok: true, ...payload }` after logging. Tests exercise the
 * processor body with a fake Job so coverage is exercised for each.
 */

import { userCascadeDeleteProcessor } from './user-cascade-delete.processor';
import { retentionPruneProcessor } from './retention-prune.processor';
import { attachmentsCleanupProcessor } from './attachments-cleanup.processor';
import { abuseReportNotifyProcessor } from './abuse-report-notify.processor';

function fakeJob<T>(data: T, id: string = 'job-id-1'): any {
  return { id, data };
}

describe('userCascadeDeleteProcessor', () => {
  it('returns { ok: true, userId }', async () => {
    await expect(
      userCascadeDeleteProcessor(fakeJob({ userId: 'u-1' })),
    ).resolves.toEqual({ ok: true, userId: 'u-1' });
  });
});

describe('retentionPruneProcessor', () => {
  it('returns { ok: true, runId } (numeric runId)', async () => {
    await expect(
      retentionPruneProcessor(fakeJob({ runId: 12345 })),
    ).resolves.toEqual({ ok: true, runId: 12345 });
  });

  it('returns { ok: true, runId } (string runId)', async () => {
    await expect(
      retentionPruneProcessor(fakeJob({ runId: 'manual-run' })),
    ).resolves.toEqual({ ok: true, runId: 'manual-run' });
  });
});

describe('attachmentsCleanupProcessor', () => {
  it('returns { ok: true } for an explicit attachmentId', async () => {
    await expect(
      attachmentsCleanupProcessor(fakeJob({ attachmentId: 'att-7' })),
    ).resolves.toEqual({ ok: true });
  });

  it('returns { ok: true } for a sweep (no attachmentId)', async () => {
    await expect(
      attachmentsCleanupProcessor(fakeJob({})),
    ).resolves.toEqual({ ok: true });
  });
});

describe('abuseReportNotifyProcessor', () => {
  it('returns { ok: true, reportId }', async () => {
    await expect(
      abuseReportNotifyProcessor(fakeJob({ reportId: 'rep-1' })),
    ).resolves.toEqual({ ok: true, reportId: 'rep-1' });
  });
});
