import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { BACKEND_SERVICE } from '../../common/microservice.module';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

export interface MarkReadRoomInput {
  userId: number;
  roomId: number;
  /** BigInt message id as decimal string. */
  lastReadId: string;
}

export interface MarkReadDmInput {
  userId: number;
  /** Peer user id — backend resolves to `dm_id`. */
  dmUserId: number;
  lastReadId: string;
}

/**
 * Thin BFF proxy for the backend's unread module (EPIC-09). The BFF owns
 * the session-derived `userId` and the HTTP surface; the backend owns all
 * read/count SQL.
 *
 * DM mark-reads carry `dmUserId` (the peer) rather than a resolved `dm_id`
 * because the BFF does not know the internal channel id. The backend TCP
 * handler resolves via {@link MessagesService.resolveDmChannelId} and
 * treats a missing channel as a no-op.
 */
@Injectable()
export class UnreadService {
  constructor(
    @Inject(BACKEND_SERVICE) private readonly client: ClientProxy,
    private readonly proxy: RpcProxyService,
  ) {}

  markReadRoom(input: MarkReadRoomInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.unread.markRead }, { ...input });
  }

  markReadDm(input: MarkReadDmInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.unread.markRead }, { ...input });
  }

  getForUser(userId: number) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.unread.getForUser }, { userId });
  }
}
