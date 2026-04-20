import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { UnreadService } from './unread.service';
import type { UnreadCounts } from './unread.types';

/**
 * TCP surface for EPIC-09 unread tracking. BFF dispatches these on
 * POST /rooms/:id/read, POST /dms/:userId/read, GET /unread, and from the
 * WS gateway on new-message delivery (countSince → unread.changed).
 *
 * `_sys` envelope is consumed by the global `SystemKeyRpcGuard`; handlers
 * ignore it. Domain errors bubble via `RpcExceptionFilter`.
 */

interface MarkReadPayload {
  userId: number;
  roomId?: number;
  dmId?: number;
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
  constructor(private readonly service: UnreadService) {}

  @MessagePattern({ cmd: TcpCmd.unread.markRead })
  async markRead(@Payload() data: MarkReadPayload): Promise<{ ok: true }> {
    await this.service.markRead({
      userId: data.userId,
      roomId: data.roomId,
      dmId: data.dmId,
      lastReadId: data.lastReadId,
    });
    return { ok: true };
  }

  @MessagePattern({ cmd: TcpCmd.unread.getForUser })
  getForUser(@Payload() data: GetForUserPayload): Promise<UnreadCounts> {
    return this.service.getUnreadCounts({ userId: data.userId });
  }

  @MessagePattern({ cmd: TcpCmd.unread.countSince })
  async countSince(
    @Payload() data: CountSincePayload,
  ): Promise<{ count: number }> {
    const count = await this.service.countSince({
      userId: data.userId,
      roomId: data.roomId,
      dmId: data.dmId,
    });
    return { count };
  }
}
