import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { abuseReports, users } from '../../database/schema';
import {
  AbuseReportRow,
  AbuseReportsRepositoryPort,
  InsertAbuseReportInput,
  ListOpenRepoInput,
  ReportStatus,
  UserRoleRow,
} from './abuse-reports.types';

/**
 * Drizzle adapter for `AbuseReportsRepositoryPort`. Owns every Drizzle call
 * the abuse-reports domain needs so `AbuseReportsService` stays free of
 * schema + query-builder concerns.
 *
 * The partial UNIQUE `(reporter_id, target_type, target_id) WHERE
 * status='open'` lives in the schema; the adapter simply re-throws PG's
 * `23505` so the service can translate to wire-level CONFLICT.
 */
@Injectable()
export class DrizzleAbuseReportsRepository implements AbuseReportsRepositoryPort {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async insert(input: InsertAbuseReportInput): Promise<AbuseReportRow> {
    const rows = await (this.db as any)
      .insert(abuseReports)
      .values({
        reporterId: input.reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
      })
      .returning();
    return rows[0] as AbuseReportRow;
  }

  async findUserById(id: number): Promise<UserRoleRow | null> {
    const rows = await (this.db as any).select().from(users).where(eq(users.id, id)).limit(1);
    return (rows[0] as UserRoleRow | undefined) ?? null;
  }

  async listOpen(input: ListOpenRepoInput): Promise<AbuseReportRow[]> {
    const filters: any[] = [eq(abuseReports.status, 'open')];
    if (input.before) {
      filters.push(
        or(
          lt(abuseReports.createdAt, input.before.createdAt),
          and(
            eq(abuseReports.createdAt, input.before.createdAt),
            lt(abuseReports.id, input.before.id),
          ),
        ),
      );
    }

    const rows = await (this.db as any)
      .select()
      .from(abuseReports)
      .where(and(...filters))
      .orderBy(desc(abuseReports.createdAt), desc(abuseReports.id))
      .limit(input.limit);
    return rows as AbuseReportRow[];
  }

  async findById(id: bigint): Promise<AbuseReportRow | null> {
    const rows = await (this.db as any)
      .select()
      .from(abuseReports)
      .where(eq(abuseReports.id, id))
      .limit(1);
    return (rows[0] as AbuseReportRow | undefined) ?? null;
  }

  async updateStatus(
    id: bigint,
    status: Exclude<ReportStatus, 'open'>,
    resolvedBy: number,
    resolvedAt: Date,
  ): Promise<void> {
    await (this.db as any)
      .update(abuseReports)
      .set({ status, resolvedBy, resolvedAt })
      .where(eq(abuseReports.id, id));
  }
}
