import { Controller, HttpException } from '@nestjs/common';
import { MessagePattern, Payload, RpcException } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { BansService } from './bans.service';

function toRpc<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e) => {
    if (e instanceof HttpException) {
      const response = e.getResponse();
      const message =
        typeof response === 'string' ? response : (response as any).message ?? e.message;
      throw new RpcException({ status: e.getStatus(), message });
    }
    throw e;
  });
}

@Controller()
export class BansTcpController {
  constructor(private readonly service: BansService) {}

  @MessagePattern({ cmd: TcpCmd.users.ban })
  ban(@Payload() data: { bannerId: number; bannedId: number; _sys?: string }) {
    return toRpc(() =>
      this.service.banUser({ bannerId: data.bannerId, bannedId: data.bannedId }),
    );
  }

  @MessagePattern({ cmd: TcpCmd.users.unban })
  unban(@Payload() data: { bannerId: number; bannedId: number; _sys?: string }) {
    return toRpc(() =>
      this.service.unbanUser({ bannerId: data.bannerId, bannedId: data.bannedId }),
    );
  }
}
