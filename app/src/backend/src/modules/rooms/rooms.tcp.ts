import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { RoomsService } from './rooms.service';

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

interface UpdatePayload {
  roomId: number;
  actorId: number;
  patch: {
    name?: string;
    description?: string | null;
    visibility?: 'public' | 'private';
  };
  _sys?: string;
}

/**
 * TCP-facing controller mirroring the HTTP surface for BFF -> backend RPC.
 * Handlers dispatch straight to the service; HttpException translation to
 * RpcException is done once, globally, by `RpcExceptionFilter` wired in
 * `microservice.ts`. See `common/rpc/rpc-exception.filter.ts`.
 */
@Controller()
export class RoomsTcpController {
  constructor(private readonly service: RoomsService) {}

  @MessagePattern({ cmd: TcpCmd.rooms.create })
  create(@Payload() data: CreatePayload) {
    return this.service.create(data);
  }

  @MessagePattern({ cmd: TcpCmd.rooms.join })
  join(@Payload() data: JoinLeavePayload) {
    return this.service.join(data);
  }

  @MessagePattern({ cmd: TcpCmd.rooms.leave })
  async leave(@Payload() data: JoinLeavePayload) {
    await this.service.leave(data);
    return { ok: true };
  }

  @MessagePattern({ cmd: TcpCmd.rooms.invite })
  invite(@Payload() data: InvitePayload) {
    return this.service.invite(data);
  }

  @MessagePattern({ cmd: TcpCmd.rooms.listMy })
  listMy(@Payload() data: ListMyPayload) {
    return this.service.listMy(data.userId);
  }

  @MessagePattern({ cmd: TcpCmd.rooms.catalog })
  catalog() {
    return this.service.catalog();
  }

  @MessagePattern({ cmd: TcpCmd.rooms.membersOf })
  membersOf(@Payload() data: MembersOfPayload) {
    return this.service.membersOf(data.roomId);
  }

  @MessagePattern({ cmd: TcpCmd.rooms.ensureMember })
  ensureMember(@Payload() data: EnsureMemberPayload) {
    return this.service.ensureMember(data);
  }

  @MessagePattern({ cmd: TcpCmd.rooms.update })
  update(@Payload() data: UpdatePayload) {
    return this.service.update({
      roomId: data.roomId,
      actorId: data.actorId,
      patch: data.patch ?? {},
    });
  }
}
