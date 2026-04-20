import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { MessagesService } from './messages.service';

/**
 * TCP-facing controller for BFF -> backend messaging RPC (EPIC-07).
 *
 * Exception translation happens globally via `RpcExceptionFilter` (see
 * `common/rpc/rpc-exception.filter.ts` + `src/microservice.ts`) — handlers
 * dispatch straight to the service and let HttpException bubble up.
 *
 * Payloads may carry a `_sys` shared-secret envelope key injected by the
 * BFF `withSys(...)` helper; `SystemKeyRpcGuard` consumes it upstream.
 */

interface CreatePayload {
  authorId: number;
  roomId?: number;
  dmUserId?: number;
  body: string;
  replyToId?: bigint | null;
  attachmentIds?: string[];
  _sys?: string;
}

interface EditPayload {
  id: bigint;
  actorId: number;
  body: string;
  _sys?: string;
}

interface DeletePayload {
  id: bigint;
  actorId: number;
  isRoomAdmin: boolean;
  _sys?: string;
}

interface ListPayload {
  roomId?: number;
  dmId?: number;
  before?: { createdAt: Date; id: bigint };
  limit: number;
  _sys?: string;
}

interface SincePayload {
  roomId?: number;
  dmId?: number;
  lastSeenId: bigint;
  limit: number;
  _sys?: string;
}

interface GetByIdPayload {
  id: bigint;
  _sys?: string;
}

@Controller()
export class MessagesTcpController {
  constructor(private readonly service: MessagesService) {}

  @MessagePattern({ cmd: TcpCmd.messages.create })
  create(@Payload() data: CreatePayload) {
    return this.service.create({
      authorId: data.authorId,
      roomId: data.roomId,
      dmUserId: data.dmUserId,
      body: data.body,
      replyToId: data.replyToId,
      attachmentIds: data.attachmentIds,
    });
  }

  @MessagePattern({ cmd: TcpCmd.messages.edit })
  edit(@Payload() data: EditPayload) {
    return this.service.edit({
      id: data.id,
      actorId: data.actorId,
      body: data.body,
    });
  }

  @MessagePattern({ cmd: TcpCmd.messages.delete })
  async delete(@Payload() data: DeletePayload) {
    await this.service.delete({
      id: data.id,
      actorId: data.actorId,
      isRoomAdmin: data.isRoomAdmin,
    });
    return { ok: true };
  }

  @MessagePattern({ cmd: TcpCmd.messages.list })
  list(@Payload() data: ListPayload) {
    return this.service.list({
      roomId: data.roomId,
      dmId: data.dmId,
      before: data.before,
      limit: data.limit,
    });
  }

  @MessagePattern({ cmd: TcpCmd.messages.since })
  since(@Payload() data: SincePayload) {
    return this.service.since({
      roomId: data.roomId,
      dmId: data.dmId,
      lastSeenId: data.lastSeenId,
      limit: data.limit,
    });
  }

  @MessagePattern({ cmd: TcpCmd.messages.getById })
  getById(@Payload() data: GetByIdPayload) {
    return this.service.getById(data.id);
  }
}
