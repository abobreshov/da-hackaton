import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { AbuseReportsService } from './abuse-reports.service';

interface CreatePayload {
  reporterId: number;
  targetType: 'message' | 'user';
  targetId: number | string | bigint;
  reason: string;
}

interface ResolvePayload {
  id: number | string | bigint;
  adminId: number;
  note?: string;
}

interface DismissPayload extends ResolvePayload {}

interface ListPayload {
  adminId: number;
  limit: number;
  beforeCreatedAt?: string;
  beforeId?: number | string | bigint;
}

function toBig(v: number | string | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

/**
 * TCP surface for abuse reports. HttpException -> RpcException translation is
 * handled globally by `RpcExceptionFilter`; handlers just delegate.
 */
@Controller()
export class AbuseReportsTcpController {
  constructor(private readonly service: AbuseReportsService) {}

  @MessagePattern({ cmd: TcpCmd.reports.create })
  create(@Payload() data: CreatePayload) {
    return this.service.create({
      reporterId: data.reporterId,
      targetType: data.targetType,
      targetId: toBig(data.targetId),
      reason: data.reason,
    });
  }

  @MessagePattern({ cmd: TcpCmd.reports.resolve })
  async resolve(@Payload() data: ResolvePayload) {
    await this.service.resolve({
      id: toBig(data.id),
      adminId: data.adminId,
      note: data.note,
    });
    return { ok: true };
  }

  @MessagePattern({ cmd: TcpCmd.reports.dismiss })
  async dismiss(@Payload() data: DismissPayload) {
    await this.service.dismiss({
      id: toBig(data.id),
      adminId: data.adminId,
      note: data.note,
    });
    return { ok: true };
  }

  @MessagePattern({ cmd: TcpCmd.reports.list })
  list(@Payload() data: ListPayload) {
    const before =
      data.beforeCreatedAt && data.beforeId !== undefined
        ? { createdAt: new Date(data.beforeCreatedAt), id: toBig(data.beforeId) }
        : undefined;
    return this.service.listOpen({
      adminId: data.adminId,
      limit: data.limit,
      before,
    });
  }
}
