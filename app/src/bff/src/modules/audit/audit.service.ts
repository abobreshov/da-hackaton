import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { BACKEND_SERVICE } from '../../common/microservice.module';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

export interface AuditPageInput {
  actor?: number;
  action?: string;
  from?: string | Date;
  to?: string | Date;
  limit?: number;
  before?: { createdAt: string | Date; id: string | number | bigint };
}

/**
 * Admin-only audit log feed. Wraps the single `TcpCmd.audit.page` command;
 * the backend handler does the date / bigint coercion. We keep the wire type
 * strings for JSON portability.
 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(BACKEND_SERVICE) private readonly client: ClientProxy,
    private readonly proxy: RpcProxyService,
  ) {}

  page(input: AuditPageInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.audit.page }, { ...input });
  }
}
