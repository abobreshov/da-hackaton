import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ErrorCode, WireError } from '@app/contracts';
import { EVENT_PUBLISHER, IEventPublisher } from '../../common/events/event-publisher.interface';
import {
  ABUSE_REPORTS_REPOSITORY,
  AbuseReportRow,
  AbuseReportsRepositoryPort,
  ReportStatus,
  TargetType,
} from './abuse-reports.types';

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
 *   reads `users.role` via the repository.
 * - Every successful state transition emits a domain event via
 *   `IEventPublisher`. The `AuditSubscriber` (registered in EventsModule)
 *   translates those events into `AuditService.append(...)` calls — this
 *   service is intentionally unaware of audit concerns.
 */
@Injectable()
export class AbuseReportsService {
  constructor(
    @Inject(ABUSE_REPORTS_REPOSITORY)
    private readonly repo: AbuseReportsRepositoryPort,
    @Inject(EVENT_PUBLISHER)
    private readonly events: IEventPublisher,
  ) {}

  private async assertAdmin(adminId: number): Promise<void> {
    const user = await this.repo.findUserById(adminId);
    if (!user || user.role !== 'ADMIN') {
      throw new ForbiddenException('admin required');
    }
  }

  async create(input: CreateReportInput): Promise<AbuseReportRow> {
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

    let row: AbuseReportRow;
    try {
      row = await this.repo.insert({
        reporterId: input.reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
      });
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: 'you already have an open report against this target',
        } as WireError);
      }
      throw err;
    }

    this.events.emit('report.create', {
      actorId: input.reporterId,
      reportId: row.id,
      targetType: input.targetType,
      targetId: input.targetId,
    });

    return row;
  }

  async listOpen(input: ListOpenInput): Promise<AbuseReportRow[]> {
    await this.assertAdmin(input.adminId);
    const limit = Math.min(Math.max(1, input.limit), MAX_LIMIT);
    return this.repo.listOpen({ limit, before: input.before });
  }

  async resolve(input: ResolveInput): Promise<void> {
    await this.assertAdmin(input.adminId);
    await this.transitionStatus(input.id, 'resolved', input.adminId);
    this.events.emit('report.resolve', {
      actorId: input.adminId,
      reportId: input.id,
      note: input.note,
    });
  }

  async dismiss(input: DismissInput): Promise<void> {
    await this.assertAdmin(input.adminId);
    await this.transitionStatus(input.id, 'dismissed', input.adminId);
    this.events.emit('report.dismiss', {
      actorId: input.adminId,
      reportId: input.id,
      note: input.note,
    });
  }

  private async transitionStatus(
    id: bigint,
    to: Exclude<ReportStatus, 'open'>,
    adminId: number,
  ): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('report not found');
    await this.repo.updateStatus(id, to, adminId, new Date());
  }
}
