import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

const logger = new Logger('RetentionPruneProcessor');

export interface RetentionPrunePayload {
  runId: number | string;
}

export interface RetentionPruneResult {
  ok: true;
  runId: number | string;
}

/**
 * Stub processor for `retention.prune`.
 *
 * Real behavior (to be implemented): scan domain tables for rows past
 * the retention window (messages / attachments / audit log / abuse
 * reports) and delete them in batches. Stub returns ok.
 */
export async function retentionPruneProcessor(
  job: Job<RetentionPrunePayload, RetentionPruneResult>,
): Promise<RetentionPruneResult> {
  const { runId } = job.data;
  logger.log(`[stub] retention-prune run=${runId} job=${job.id}`);
  return { ok: true, runId };
}
