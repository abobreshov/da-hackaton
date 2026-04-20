import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { UnreadService } from './unread.service';
import type { UnreadCounts } from './unread.types';
import { MessagesService } from '../messages/messages.service';

/**
 * TCP surface for EPIC-09 unread tracking. BFF dispatches these on
 * POST /rooms/:id/read, POST /dms/:userId/read, GET /unread, and from the
 * WS gateway on new-message delivery (countSince → unread.changed).
 *
 * `_sys` envelope is consumed by the global `SystemKeyRpcGuard`; handlers
 * ignore it. Domain errors bubble via `RpcExceptionFilter`.
 *
 * The BFF does not know the internal `dm_id` for a given peer pair; when it
 * forwards a DM-scoped markRead it sends `dmUserId` (the peer) instead and
 * the handler resolves to `dm_id` via `MessagesService.resolveDmChannelId`.
 * When the channel has not been provisioned yet (no DM has ever been sent)
 * the call is a no-op: there is nothing to mark.
 */

interface MarkReadPayload {
  userId: number;
  roomId?: number;
  dmId?: number;
  /** Peer user id for a DM mark-read when the BFF has not resolved dmId. */
  dmUserId?: number;
  lastReadId: bigint;
  _sys?: string;
}

interface GetForUserPayload {
  userId: number;
  _sys?: string;
}

interface CountSincePayload {
  userId: number;
  roomId?: number;
  dmId?: number;
  _sys?: string;
}

@Controller()
export class UnreadTcpController {
  constructor(
    private readonly service: UnreadService,
    private readonly messages: MessagesService,
  ) {}

  @MessagePattern({ cmd: TcpCmd.unread.markRead })
  async markRead(@Payload() data: MarkReadPayload): Promise<{ ok: true }> {
    let dmId = data.dmId;
    if (dmId == null && data.dmUserId != null) {
      const resolved = await this.messages.resolveDmChannelId(data.userId, data.dmUserId);
      if (resolved == null) {
        // No DM exchange yet → nothing to mark as read. Return a benign ack
        // so the UI does not have to special-case first-load state.
        return { ok: true };
      }
      dmId = resolved;
    }
    await this.service.markRead({
      userId: data.userId,
      roomId: data.roomId,
      dmId,
      lastReadId: data.lastReadId,
    });
    return { ok: true };
  }

  @MessagePattern({ cmd: TcpCmd.unread.getForUser })
  getForUser(@Payload() data: GetForUserPayload): Promise<UnreadCounts> {
    return this.service.getUnreadCounts({ userId: data.userId });
  }

  @MessagePattern({ cmd: TcpCmd.unread.countSince })
  async countSince(@Payload() data: CountSincePayload): Promise<{ count: number }> {
    const count = await this.service.countSince({
      userId: data.userId,
      roomId: data.roomId,
      dmId: data.dmId,
    });
    return { count };
  }
}
