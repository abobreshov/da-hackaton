import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { UserCascadeDeletePayload } from './processors/user-cascade-delete.processor';
import type { RetentionPrunePayload } from './processors/retention-prune.processor';
import type { AttachmentsCleanupPayload } from './processors/attachments-cleanup.processor';
import type { AbuseReportNotifyPayload } from './processors/abuse-report-notify.processor';
import {
  ABUSE_REPORT_NOTIFY_QUEUE,
  ATTACHMENTS_CLEANUP_QUEUE,
  RETENTION_PRUNE_QUEUE,
  USER_CASCADE_DELETE_QUEUE,
} from './queue.tokens';

/**
 * Thin, typed wrappers around `Queue.add(...)` for each named queue.
 *
 * Services depending on async work should inject `QueueProducer` and
 * call the appropriate `enqueue*` method rather than constructing BullMQ
 * jobs directly — this keeps queue names + payload shapes in one place.
 */
@Injectable()
export class QueueProducer {
  constructor(
    @Inject(USER_CASCADE_DELETE_QUEUE)
    private readonly userCascadeDeleteQueue: Queue<UserCascadeDeletePayload>,
    @Inject(RETENTION_PRUNE_QUEUE)
    private readonly retentionPruneQueue: Queue<RetentionPrunePayload>,
    @Inject(ATTACHMENTS_CLEANUP_QUEUE)
    private readonly attachmentsCleanupQueue: Queue<AttachmentsCleanupPayload>,
    @Inject(ABUSE_REPORT_NOTIFY_QUEUE)
    private readonly abuseReportNotifyQueue: Queue<AbuseReportNotifyPayload>,
  ) {}

  async enqueueUserCascadeDelete(userId: string) {
    return this.userCascadeDeleteQueue.add('user.cascade.delete', { userId });
  }

  async enqueueRetentionPrune(runId: number | string = Date.now()) {
    return this.retentionPruneQueue.add('retention.prune', { runId });
  }

  async enqueueAttachmentsCleanup(attachmentId?: string) {
    return this.attachmentsCleanupQueue.add('attachments.cleanup', {
      attachmentId,
    });
  }

  async enqueueAbuseReportNotify(reportId: string) {
    return this.abuseReportNotifyQueue.add('abuse.report.notify', { reportId });
  }
}
