import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { BACKEND_SERVICE } from '../../common/microservice.module';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

export interface BanInput {
  bannerId: number;
  bannedId: number;
}

export interface ListBansInput {
  userId: number;
}

/**
 * BFF proxy for user-to-user bans. Every method delegates to
 * {@link RpcProxyService.forward} which owns the `_sys` envelope, upstream
 * timeout, and RxJS→Promise glue.
 */
@Injectable()
export class BansService {
  constructor(
    @Inject(BACKEND_SERVICE) private readonly client: ClientProxy,
    private readonly proxy: RpcProxyService,
  ) {}

  ban(input: BanInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.users.ban }, { ...input });
  }

  unban(input: BanInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.users.unban }, { ...input });
  }

  listBans(input: ListBansInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.users.listBans }, { ...input });
  }
}
