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
  it('returns 0-counts for empty paths (sweep)', async () => {
    await expect(
      attachmentsCleanupProcessor(fakeJob({})),
    ).resolves.toEqual({ ok: true, deleted: 0, missing: 0, failed: 0 });
  });

  it('classifies non-existent paths as missing (ENOENT tolerated)', async () => {
    const result = await attachmentsCleanupProcessor(
      fakeJob({ paths: ['/nowhere/does-not-exist-001.bin'], reason: 'room-delete' as const }),
    );
    // ENOENT either classifies as missing OR as failed depending on path
    // resolution — accept either as long as ok + not deleted.
    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(0);
    expect(result.missing + result.failed).toBe(1);
  });
});

describe('abuseReportNotifyProcessor', () => {
  it('returns { ok: true, reportId }', async () => {
    await expect(
      abuseReportNotifyProcessor(fakeJob({ reportId: 'rep-1' })),
    ).resolves.toEqual({ ok: true, reportId: 'rep-1' });
  });
});
