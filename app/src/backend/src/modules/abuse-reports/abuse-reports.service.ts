import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { ErrorCode, WireError } from '@app/contracts';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { abuseReports, users } from '../../database/schema';
import { AuditService } from '../audit/audit.service';

function wire(status: HttpStatus, code: ErrorCode, message: string): HttpException {
  const body: WireError = { code, message };
  return new HttpException(body, status);
}

type TargetType = 'message' | 'user';
type Status = 'open' | 'resolved' | 'dismissed';

export interface CreateReportInput {
  reporterId: number;
  targetType: TargetType;
  targetId: bigint;
  reason: string;
}

export interface ListOpenInput {
  adminId: number;
  limit: number;
  before?: { createdAt: Date; id: bigint };
}

export interface ResolveInput {
  id: bigint;
  adminId: number;
  note?: string;
}

export interface DismissInput {
  id: bigint;
  adminId: number;
  note?: string;
}

const MAX_REASON_LEN = 500;
const MAX_LIMIT = 200;
const VALID_TARGETS: readonly TargetType[] = ['message', 'user'] as const;

/**
 * AbuseReportsService — EPIC-06 user-filed abuse reports.
 *
 * - `create()` enforces reason length + valid targetType before DB hit, then
 *   maps the partial-UNIQUE violation (status='open' dedup) to CONFLICT (409).
 * - `listOpen()` / `resolve()` / `dismiss()` are admin-only; the admin gate
 *   reads users.role.
 * - Every successful state transition writes an audit_log row via
 *   AuditService.append (best-effort, post-commit).
 */
@Injectable()
export class AbuseReportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private async assertAdmin(adminId: number): Promise<void> {
    const rows = await (this.db as any)
      .select()
      .from(users)
      .where(eq(users.id, adminId))
      .limit(1);
    const user = rows[0];
    if (!user || user.role !== 'ADMIN') {
      throw new ForbiddenException('admin required');
    }
  }

  async create(input: CreateReportInput): Promise<any> {
    if (!input.reason || input.reason.length === 0) {
      throw new BadRequestException('reason is required');
    }
    if (input.reason.length > MAX_REASON_LEN) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'reason exceeds 500 chars',
      } as WireError);
    }
    if (!VALID_TARGETS.includes(input.targetType)) {
      throw new BadRequestException('targetType must be "message" or "user"');
    }

    try {
      const rows = await (this.db as any)
        .insert(abuseReports)
        .values({
          reporterId: input.reporterId,
          targetType: input.targetType,
          targetId: input.targetId,
          reason: input.reason,
        })
        .returning();
      return rows[0];
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: 'you already have an open report against this target',
        } as WireError);
      }
      throw err;
    }
  }

  async listOpen(input: ListOpenInput): Promise<any[]> {
    await this.assertAdmin(input.adminId);
    const limit = Math.min(Math.max(1, input.limit), MAX_LIMIT);

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
      .limit(limit);
    return rows;
  }

  async resolve(input: ResolveInput): Promise<void> {
    await this.assertAdmin(input.adminId);
    await this.transitionStatus(input.id, 'resolved', input.adminId);
    await this.audit.append({
      actorId: input.adminId,
      actorType: 'admin',
      action: 'report.resolve',
      targetType: 'abuse_report',
      targetId: input.id,
      metadata: input.note ? { note: input.note } : undefined,
    });
  }

  async dismiss(input: DismissInput): Promise<void> {
    await this.assertAdmin(input.adminId);
    await this.transitionStatus(input.id, 'dismissed', input.adminId);
    await this.audit.append({
      actorId: input.adminId,
      actorType: 'admin',
      action: 'report.dismiss',
      targetType: 'abuse_report',
      targetId: input.id,
      metadata: input.note ? { note: input.note } : undefined,
    });
  }

  private async transitionStatus(
    id: bigint,
    to: Exclude<Status, 'open'>,
    adminId: number,
  ): Promise<void> {
    const rows = await (this.db as any)
      .select()
      .from(abuseReports)
      .where(eq(abuseReports.id, id))
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundException('report not found');

    const now = new Date();
    await (this.db as any)
      .update(abuseReports)
      .set({ status: to, resolvedBy: adminId, resolvedAt: now })
      .where(eq(abuseReports.id, id));
  }
}
