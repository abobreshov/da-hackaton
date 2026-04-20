import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

const logger = new Logger('AbuseReportNotifyProcessor');

export interface AbuseReportNotifyPayload {
  reportId: string;
}

export interface AbuseReportNotifyResult {
  ok: true;
  reportId: string;
}

/**
 * Stub processor for `abuse.report.notify`.
 *
 * Real behavior (to be implemented): notify admin channel (email /
 * webhook / in-app bell) when a new abuse report is filed. Stub returns
 * ok.
 */
export async function abuseReportNotifyProcessor(
  job: Job<AbuseReportNotifyPayload, AbuseReportNotifyResult>,
): Promise<AbuseReportNotifyResult> {
  const { reportId } = job.data;
  logger.log(`[stub] abuse-report-notify report=${reportId} job=${job.id}`);
  return { ok: true, reportId };
}
