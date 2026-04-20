import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { BansService } from './bans.service';

/**
 * TCP surface for the global user-level ban list. HttpException -> RpcException
 * translation is handled globally by `RpcExceptionFilter`; handlers just
 * delegate to the service.
 */
@Controller()
export class BansTcpController {
  constructor(private readonly service: BansService) {}

  @MessagePattern({ cmd: TcpCmd.users.ban })
  ban(@Payload() data: { bannerId: number; bannedId: number; _sys?: string }) {
    return this.service.banUser({ bannerId: data.bannerId, bannedId: data.bannedId });
  }

  @MessagePattern({ cmd: TcpCmd.users.unban })
  unban(@Payload() data: { bannerId: number; bannedId: number; _sys?: string }) {
    return this.service.unbanUser({ bannerId: data.bannerId, bannedId: data.bannedId });
  }

  @MessagePattern({ cmd: TcpCmd.users.listBans })
  listBans(@Payload() data: { userId: number; _sys?: string }) {
    return this.service.listBansByUser({ userId: data.userId });
  }
}
