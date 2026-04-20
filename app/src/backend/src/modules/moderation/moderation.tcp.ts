import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { ModerationService } from './moderation.service';

/**
 * TCP-facing controller mirroring `ModerationController` for BFF -> backend
 * RPC. Fills the M2 blocker where `ModerationModule` shipped only an HTTP
 * surface — promote / demote / ban / unban / listBans / deleteRoom are now
 * reachable over the internal Nest microservice transport.
 *
 * House rules:
 *   - HttpException -> RpcException translation happens globally via
 *     `RpcExceptionFilter` (see `common/rpc/rpc-exception.filter.ts`).
 *     Handlers dispatch straight to the service.
 *   - Actor identity is named `actorId` on the wire. The service internally
 *     uses `adminId` (ban/unban) and `viewerId` (listBans); the controller
 *     renames without exposing that ambiguity to RPC callers.
 *   - Payloads may carry a `_sys` shared-secret envelope key injected by the
 *     BFF `withSys(...)` helper; `SystemKeyRpcGuard` consumes it upstream.
 *     Controllers just destructure the fields they need and ignore the rest.
 */

interface RoleChangePayload {
  roomId: number;
  actorId: number;
  userId: number;
  _sys?: string;
}

interface BanPayload {
  roomId: number;
  actorId: number;
  userId: number;
  _sys?: string;
}

interface ListBansPayload {
  roomId: number;
  actorId: number;
  _sys?: string;
}

interface DeleteRoomPayload {
  roomId: number;
  actorId: number;
  _sys?: string;
}

@Controller()
export class ModerationTcpController {
  constructor(private readonly service: ModerationService) {}

  @MessagePattern({ cmd: TcpCmd.rooms.members.promote })
  promote(@Payload() data: RoleChangePayload) {
    return this.service.promote({
      roomId: data.roomId,
      actorId: data.actorId,
      userId: data.userId,
    });
  }

  @MessagePattern({ cmd: TcpCmd.rooms.members.demote })
  demote(@Payload() data: RoleChangePayload) {
    return this.service.demote({
      roomId: data.roomId,
      actorId: data.actorId,
      userId: data.userId,
    });
  }

  @MessagePattern({ cmd: TcpCmd.rooms.members.ban })
  banMember(@Payload() data: BanPayload) {
    return this.service.banMember({
      roomId: data.roomId,
      adminId: data.actorId,
      userId: data.userId,
    });
  }

  @MessagePattern({ cmd: TcpCmd.rooms.bans.unban })
  unbanMember(@Payload() data: BanPayload) {
    return this.service.unbanMember({
      roomId: data.roomId,
      adminId: data.actorId,
      userId: data.userId,
    });
  }

  @MessagePattern({ cmd: TcpCmd.rooms.bans.list })
  listBans(@Payload() data: ListBansPayload) {
    return this.service.listBans({
      roomId: data.roomId,
      viewerId: data.actorId,
    });
  }

  @MessagePattern({ cmd: TcpCmd.rooms.delete })
  deleteRoom(@Payload() data: DeleteRoomPayload) {
    return this.service.deleteRoom({
      roomId: data.roomId,
      actorId: data.actorId,
    });
  }
}
