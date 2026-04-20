import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { RoomsService } from './rooms.service';
import { toRpc } from './rpc.util';

interface CreatePayload {
  ownerId: number;
  name: string;
  visibility: 'public' | 'private';
  description?: string;
}

interface JoinLeavePayload {
  userId: number;
  roomId: number;
}

interface InvitePayload {
  inviterId: number;
  inviteeId: number;
  roomId: number;
}

interface ListMyPayload {
  userId: number;
}

interface MembersOfPayload {
  roomId: number;
}

interface EnsureMemberPayload {
  roomId: number;
  userId: number;
}

/**
 * TCP-facing controller mirroring the HTTP surface for BFF → backend RPC.
 * Errors are normalised via `toRpc` so HttpException-kind failures surface
 * as RpcException({status, message}) — matches how auth-service wraps.
 */
@Controller()
export class RoomsTcpController {
  constructor(private readonly service: RoomsService) {}

  @MessagePattern({ cmd: TcpCmd.rooms.create })
  create(@Payload() data: CreatePayload) {
    return toRpc(() => this.service.create(data));
  }

  @MessagePattern({ cmd: TcpCmd.rooms.join })
  join(@Payload() data: JoinLeavePayload) {
    return toRpc(() => this.service.join(data));
  }

  @MessagePattern({ cmd: TcpCmd.rooms.leave })
  leave(@Payload() data: JoinLeavePayload) {
    return toRpc(async () => {
      await this.service.leave(data);
      return { ok: true };
    });
  }

  @MessagePattern({ cmd: TcpCmd.rooms.invite })
  invite(@Payload() data: InvitePayload) {
    return toRpc(() => this.service.invite(data));
  }

  @MessagePattern({ cmd: TcpCmd.rooms.listMy })
  listMy(@Payload() data: ListMyPayload) {
    return toRpc(() => this.service.listMy(data.userId));
  }

  @MessagePattern({ cmd: TcpCmd.rooms.catalog })
  catalog() {
    return toRpc(() => this.service.catalog());
  }

  @MessagePattern({ cmd: TcpCmd.rooms.membersOf })
  membersOf(@Payload() data: MembersOfPayload) {
    return toRpc(() => this.service.membersOf(data.roomId));
  }

  @MessagePattern({ cmd: TcpCmd.rooms.ensureMember })
  ensureMember(@Payload() data: EnsureMemberPayload) {
    return toRpc(() => this.service.ensureMember(data));
  }
}
