import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { BACKEND_SERVICE } from '../../common/microservice.module';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

export interface RoomRoleChange {
  roomId: number;
  userId: number;
  actorId: number;
}

export interface RoomBanOp extends RoomRoleChange {}

export interface ListRoomBansInput {
  roomId: number;
  actorId: number;
}

export interface DeleteRoomInput {
  roomId: number;
  actorId: number;
}

/**
 * Room-level moderation (promote / demote / ban / unban / list bans / delete).
 * Mirrors the backend `ModerationService` through the TCP commands under
 * `TcpCmd.rooms.members.*`, `TcpCmd.rooms.bans.*`, and `TcpCmd.rooms.delete`.
 */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(BACKEND_SERVICE) private readonly client: ClientProxy,
    private readonly proxy: RpcProxyService,
  ) {}

  promote(input: RoomRoleChange) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.rooms.members.promote }, { ...input });
  }

  demote(input: RoomRoleChange) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.rooms.members.demote }, { ...input });
  }

  banMember(input: RoomBanOp) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.rooms.members.ban }, { ...input });
  }

  unbanMember(input: RoomBanOp) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.rooms.bans.unban }, { ...input });
  }

  listBans(input: ListRoomBansInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.rooms.bans.list }, { ...input });
  }

  deleteRoom(input: DeleteRoomInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.rooms.delete }, { ...input });
  }
}
