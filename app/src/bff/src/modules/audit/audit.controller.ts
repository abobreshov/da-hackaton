import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService, AuditPageInput } from './audit.service';
import { SessionGuard } from '../../auth/session.guard';
import { AdminGuard } from '../../common/guards/admin.guard';

/**
 * Admin audit-log feed. Query params mirror the backend HTTP surface:
 *
 *   ?actor=<userId> &action=<string>
 *   &from=<iso>     &to=<iso>
 *   &limit=<1..200>
 *   &beforeCreatedAt=<iso> &beforeId=<bigint>
 *
 * Cursor paging: pass both `beforeCreatedAt` + `beforeId` of the last row
 * from the previous page to get the next.
 */
@Controller('admin/audit-log')
@UseGuards(SessionGuard, AdminGuard)
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  page(
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('beforeCreatedAt') beforeCreatedAt?: string,
    @Query('beforeId') beforeId?: string,
  ) {
    const input: AuditPageInput = {};
    if (actor) input.actor = Number(actor);
    if (action) input.action = action;
    if (from) input.from = from;
    if (to) input.to = to;
    if (limit) input.limit = Math.max(1, Math.min(Number(limit), 200));
    if (beforeCreatedAt && beforeId) {
      input.before = { createdAt: beforeCreatedAt, id: beforeId };
    }
    return this.service.page(input);
  }
}
