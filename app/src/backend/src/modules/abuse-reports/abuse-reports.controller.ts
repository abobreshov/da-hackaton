import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user';
import { AbuseReportsService } from './abuse-reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { DismissReportDto } from './dto/dismiss-report.dto';

/**
 * Two surfaces:
 *   - user-facing `/reports` (POST) to file a new report
 *   - admin-facing `/admin/reports*` (list/resolve/dismiss); admin gate
 *     lives in the service so BFF-only ACLs don't have to be trusted.
 */
@Controller()
@UseGuards(JwtGuard)
export class AbuseReportsController {
  constructor(private readonly service: AbuseReportsService) {}

  @Post('reports')
  @HttpCode(201)
  create(
    @CurrentUser() user: { id: number },
    @Body() dto: CreateReportDto,
  ) {
    return this.service.create({
      reporterId: user.id,
      targetType: dto.targetType,
      targetId: dto.targetId,
      reason: dto.reason,
    });
  }

  @Get('admin/reports')
  listOpen(
    @CurrentUser() admin: { id: number },
    @Query('limit') limit?: string,
    @Query('beforeCreatedAt') beforeCreatedAt?: string,
    @Query('beforeId') beforeId?: string,
  ) {
    const parsedLimit = limit ? Math.max(1, Math.min(parseInt(limit, 10), 200)) : 50;
    const before =
      beforeCreatedAt && beforeId
        ? { createdAt: new Date(beforeCreatedAt), id: BigInt(beforeId) }
        : undefined;
    return this.service.listOpen({ adminId: admin.id, limit: parsedLimit, before });
  }

  @Post('admin/reports/:id/resolve')
  @HttpCode(204)
  async resolve(
    @CurrentUser() admin: { id: number },
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
  ) {
    await this.service.resolve({
      id: BigInt(id),
      adminId: admin.id,
      note: dto.note,
    });
  }

  @Post('admin/reports/:id/dismiss')
  @HttpCode(204)
  async dismiss(
    @CurrentUser() admin: { id: number },
    @Param('id') id: string,
    @Body() dto: DismissReportDto,
  ) {
    await this.service.dismiss({
      id: BigInt(id),
      adminId: admin.id,
      note: dto.note,
    });
  }
}
