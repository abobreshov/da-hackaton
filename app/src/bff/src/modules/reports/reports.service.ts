import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { BACKEND_SERVICE } from '../../common/microservice.module';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

export interface CreateReportInput {
  reporterId: number;
  targetType: 'message' | 'user';
  targetId: number | string | bigint;
  reason: string;
}

export interface ResolveDismissInput {
  id: number | string | bigint;
  adminId: number;
  note?: string;
}

export interface ListReportsInput {
  adminId: number;
  limit: number;
  beforeCreatedAt?: string;
  beforeId?: number | string;
}

/**
 * BFF proxy for abuse reports. Every method forwards straight through
 * {@link RpcProxyService.forward}; payload shaping (cursor parsing, bigint
 * coercion) happens on the backend side.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(BACKEND_SERVICE) private readonly client: ClientProxy,
    private readonly proxy: RpcProxyService,
  ) {}

  create(input: CreateReportInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.reports.create }, { ...input });
  }

  resolve(input: ResolveDismissInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.reports.resolve }, { ...input });
  }

  dismiss(input: ResolveDismissInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.reports.dismiss }, { ...input });
  }

  list(input: ListReportsInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.reports.list }, { ...input });
  }
}
