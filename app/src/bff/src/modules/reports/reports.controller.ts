import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { DismissReportDto } from './dto/dismiss-report.dto';
import { SessionGuard } from '../../auth/session.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ThrottleGuard } from '../../common/guards/throttle.guard';
import { Throttle } from '../../common/decorators/throttle.decorator';
import { parseSub } from '../../auth/cookie.service';

interface SessionRequest {
  session?: { sub?: string; type?: string };
}

function getUserId(req: SessionRequest): number {
  const sub = req.session?.sub;
  if (!sub) throw new Error('no userId in session');
  const { type, numericId } = parseSub(sub);
  if (type !== 'user') throw new Error('no userId in session');
  return numericId;
}

function getAdminId(req: SessionRequest): number {
  const sub = req.session?.sub;
  if (!sub) throw new Error('no adminId in session');
  const { type, numericId } = parseSub(sub);
  if (type !== 'admin') throw new Error('no adminId in session');
  return numericId;
}

/**
 * User-facing report creation. Separate controller from the admin one so we
 * can stack `AdminGuard` on the admin paths without it affecting `POST
 * /reports` — regular users need to be able to file reports.
 */
@Controller('reports')
@UseGuards(SessionGuard)
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Post()
  @HttpCode(201)
  // AC-14-13 — spam suppression: 10 reports per hour per user.
  // Fail-open: Redis being down must not stop people reporting abuse.
  @UseGuards(ThrottleGuard)
  @Throttle({
    scope: 'report-create',
    limit: 10,
    windowMs: 3_600_000,
    failClosed: false,
    keyFn: (req: any) => req?.session?.sub ?? 'ip:unknown',
  })
  create(@Body() dto: CreateReportDto, @Req() req: SessionRequest) {
    return this.service.create({
      reporterId: getUserId(req),
      targetType: dto.targetType,
      targetId: dto.targetId,
      reason: dto.reason,
    });
  }
}

/**
 * Admin-only operations. `SessionGuard` populates `req.session`, then
 * `AdminGuard` asserts `session.type === 'admin'`.
 */
@Controller('admin/reports')
@UseGuards(SessionGuard, AdminGuard)
export class AdminReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get()
  list(
    @Req() req: SessionRequest,
    @Query('limit') limit?: string,
    @Query('beforeCreatedAt') beforeCreatedAt?: string,
    @Query('beforeId') beforeId?: string,
  ) {
    const parsedLimit = limit ? Math.max(1, Math.min(parseInt(limit, 10) || 0, 200)) : 50;
    return this.service.list({
      adminId: getAdminId(req),
      limit: parsedLimit,
      beforeCreatedAt,
      beforeId,
    });
  }

  @Post(':id/resolve')
  @HttpCode(204)
  async resolve(
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
    @Req() req: SessionRequest,
  ) {
    await this.service.resolve({
      id,
      adminId: getAdminId(req),
      note: dto.note,
    });
  }

  @Post(':id/dismiss')
  @HttpCode(204)
  async dismiss(
    @Param('id') id: string,
    @Body() dto: DismissReportDto,
    @Req() req: SessionRequest,
  ) {
    await this.service.dismiss({
      id,
      adminId: getAdminId(req),
      note: dto.note,
    });
  }
}
