import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { AbuseReportsService } from './abuse-reports.service';
import { toRpc } from './rpc.util';

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

@Controller()
export class AbuseReportsTcpController {
  constructor(private readonly service: AbuseReportsService) {}

  @MessagePattern({ cmd: TcpCmd.reports.create })
  create(@Payload() data: CreatePayload) {
    return toRpc(() =>
      this.service.create({
        reporterId: data.reporterId,
        targetType: data.targetType,
        targetId: toBig(data.targetId),
        reason: data.reason,
      }),
    );
  }

  @MessagePattern({ cmd: TcpCmd.reports.resolve })
  resolve(@Payload() data: ResolvePayload) {
    return toRpc(async () => {
      await this.service.resolve({
        id: toBig(data.id),
        adminId: data.adminId,
        note: data.note,
      });
      return { ok: true };
    });
  }

  @MessagePattern({ cmd: TcpCmd.reports.dismiss })
  dismiss(@Payload() data: DismissPayload) {
    return toRpc(async () => {
      await this.service.dismiss({
        id: toBig(data.id),
        adminId: data.adminId,
        note: data.note,
      });
      return { ok: true };
    });
  }

  @MessagePattern({ cmd: TcpCmd.reports.list })
  list(@Payload() data: ListPayload) {
    return toRpc(() => {
      const before =
        data.beforeCreatedAt && data.beforeId !== undefined
          ? { createdAt: new Date(data.beforeCreatedAt), id: toBig(data.beforeId) }
          : undefined;
      return this.service.listOpen({
        adminId: data.adminId,
        limit: data.limit,
        before,
      });
    });
  }
}
