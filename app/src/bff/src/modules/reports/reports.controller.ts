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

interface SessionRequest {
  session?: { userId?: number; adminId?: number; type?: string };
}

function getUserId(req: SessionRequest): number {
  const raw = req.session?.userId;
  if (typeof raw !== 'number') {
    throw new Error('no userId in session');
  }
  return raw;
}

function getAdminId(req: SessionRequest): number {
  const raw = req.session?.adminId;
  if (typeof raw !== 'number') {
    throw new Error('no adminId in session');
  }
  return raw;
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
