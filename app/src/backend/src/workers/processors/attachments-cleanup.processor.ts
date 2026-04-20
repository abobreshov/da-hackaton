import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

const logger = new Logger('AttachmentsCleanupProcessor');

export interface AttachmentsCleanupPayload {
  /** Optional attachment id; when absent, the job is a sweep trigger. */
  attachmentId?: string;
}

export interface AttachmentsCleanupResult {
  ok: true;
}

/**
 * Stub processor for `attachments.cleanup`.
 *
 * Real behavior (to be implemented): delete orphaned files from the
 * attachments storage directory whose DB rows have been pruned. Stub
 * returns ok.
 */
export async function attachmentsCleanupProcessor(
  job: Job<AttachmentsCleanupPayload, AttachmentsCleanupResult>,
): Promise<AttachmentsCleanupResult> {
  logger.log(
    `[stub] attachments-cleanup job=${job.id} attachmentId=${
      job.data?.attachmentId ?? '<sweep>'
    }`,
  );
  return { ok: true };
}
