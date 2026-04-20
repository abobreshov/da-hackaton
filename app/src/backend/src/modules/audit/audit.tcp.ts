import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { AuditService } from './audit.service';
import { toRpc } from './rpc.util';

interface PagePayload {
  actor?: number;
  action?: string;
  from?: string | Date;
  to?: string | Date;
  limit?: number;
  before?: { createdAt: string | Date; id: string | number | bigint };
}

function toDate(v?: string | Date): Date | undefined {
  if (!v) return undefined;
  return v instanceof Date ? v : new Date(v);
}

function toBig(v: string | number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

@Controller()
export class AuditTcpController {
  constructor(private readonly service: AuditService) {}

  @MessagePattern({ cmd: TcpCmd.audit.page })
  page(@Payload() data: PagePayload) {
    return toRpc(() =>
      this.service.page({
        actor: data.actor,
        action: data.action,
        from: toDate(data.from),
        to: toDate(data.to),
        limit: data.limit,
        before: data.before
          ? { createdAt: toDate(data.before.createdAt)!, id: toBig(data.before.id) }
          : undefined,
      }),
    );
  }
}
