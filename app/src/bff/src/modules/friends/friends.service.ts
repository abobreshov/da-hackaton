import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { BACKEND_SERVICE } from '../../common/microservice.module';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

export interface FriendRequestInput {
  requesterId: number;
  targetUsername: string;
  text?: string;
}

export interface FriendDecisionInput {
  userId: number;
  requestId: number;
}

export interface FriendRemoveInput {
  userId: number;
  otherUserId: number;
}

export interface FriendListInput {
  userId: number;
}

/**
 * Thin BFF proxy for the backend's friends module. Every method delegates
 * straight to {@link RpcProxyService.forward} which owns the `_sys` envelope,
 * upstream timeout, and RxJS→Promise glue.
 */
@Injectable()
export class FriendsService {
  constructor(
    @Inject(BACKEND_SERVICE) private readonly client: ClientProxy,
    private readonly proxy: RpcProxyService,
  ) {}

  request(input: FriendRequestInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.friends.request }, { ...input });
  }

  accept(input: FriendDecisionInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.friends.accept }, { ...input });
  }

  reject(input: FriendDecisionInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.friends.reject }, { ...input });
  }

  remove(input: FriendRemoveInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.friends.remove }, { ...input });
  }

  list(input: FriendListInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.friends.list }, { ...input });
  }

  listPending(input: FriendListInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.friends.listPending }, { ...input });
  }
}
