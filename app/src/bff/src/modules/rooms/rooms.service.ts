import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { TcpCmd } from '@app/contracts';
import { BACKEND_SERVICE } from '../../common/microservice.module';
import { withSys } from '../../common/rpc-transport';

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
  inviteeId: number;
  roomId: number;
}

@Injectable()
export class RoomsService {
  constructor(@Inject(BACKEND_SERVICE) private readonly client: ClientProxy) {}

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

  invite(input: InviteInput) {
    return firstValueFrom(this.client.send({ cmd: TcpCmd.rooms.invite }, withSys({ ...input })));
  }
}
