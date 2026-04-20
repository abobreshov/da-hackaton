import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

const logger = new Logger('UserCascadeDeleteProcessor');

export interface UserCascadeDeletePayload {
  userId: string;
}

export interface UserCascadeDeleteResult {
  ok: true;
  userId: string;
}

/**
 * Stub processor for `user.cascade.delete`.
 *
 * Real behavior (to be implemented): delete / anonymize domain rows
 * belonging to the user (profile, messages, attachments, reports...).
 * For now we just log + ack so the worker pipeline can be exercised
 * end-to-end.
 */
export async function userCascadeDeleteProcessor(
  job: Job<UserCascadeDeletePayload, UserCascadeDeleteResult>,
): Promise<UserCascadeDeleteResult> {
  const { userId } = job.data;
  logger.log(`[stub] cascade-delete user=${userId} job=${job.id}`);
  return { ok: true, userId };
}
