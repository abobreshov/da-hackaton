import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { TcpCmd } from '@app/contracts';
import { BACKEND_SERVICE } from '../../common/microservice.module';
import { withSys } from '../../common/rpc-transport';
import { UsersService } from '../users/users.service';

export interface CreateRoomInput {
  ownerId: number;
  name: string;
  visibility: 'public' | 'private';
  description?: string;
}

export interface JoinLeaveInput {
  userId: number;
  roomId: number;
}

export interface InviteInput {
  inviterId: number;
  /** Pre-resolved numeric id. Supply **either** this or `username`. */
  inviteeId?: number;
  /** Invitee username — resolved to id via `UsersService` before RPC. */
  username?: string;
  roomId: number;
}

export interface UpdateRoomPatch {
  name?: string;
  description?: string;
  visibility?: 'public' | 'private';
}

export interface UpdateRoomInput {
  roomId: number;
  actorId: number;
  patch: UpdateRoomPatch;
}

@Injectable()
export class RoomsService {
  constructor(
    @Inject(BACKEND_SERVICE) private readonly client: ClientProxy,
    private readonly users: UsersService,
  ) {}

  catalog() {
    return firstValueFrom(this.client.send({ cmd: TcpCmd.rooms.catalog }, withSys({})));
  }

  listMy(userId: number) {
    return firstValueFrom(
      this.client.send({ cmd: TcpCmd.rooms.listMy }, withSys({ userId })),
    );
  }

  create(input: CreateRoomInput) {
    return firstValueFrom(this.client.send({ cmd: TcpCmd.rooms.create }, withSys({ ...input })));
  }

  join(input: JoinLeaveInput) {
    return firstValueFrom(this.client.send({ cmd: TcpCmd.rooms.join }, withSys({ ...input })));
  }

  leave(input: JoinLeaveInput) {
    return firstValueFrom(this.client.send({ cmd: TcpCmd.rooms.leave }, withSys({ ...input })));
  }

  /**
   * Forward an invite to the backend's `rooms.invite` RPC. Accepts either
   * `{inviteeId}` (legacy id-based callers) or `{username}` (FE popover +
   * manage-room modal) — in the latter case we resolve via
   * `UsersService.resolveUserIdByUsername` first. Backend API stays
   * `{inviterId, inviteeId, roomId}` — unchanged.
   */
  async invite(input: InviteInput) {
    const inviteeId =
      input.inviteeId ??
      (await this.users.resolveUserIdByUsername(input.username ?? ''));
    return firstValueFrom(
      this.client.send(
        { cmd: TcpCmd.rooms.invite },
        withSys({ inviterId: input.inviterId, inviteeId, roomId: input.roomId }),
      ),
    );
  }

  update(input: UpdateRoomInput) {
    return firstValueFrom(this.client.send({ cmd: TcpCmd.rooms.update }, withSys({ ...input })));
  }
}
