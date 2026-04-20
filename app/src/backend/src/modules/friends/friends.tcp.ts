import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { FriendsService } from './friends.service';

/**
 * TCP surface for the friends graph. HttpException -> RpcException translation
 * is handled globally by `RpcExceptionFilter` (see
 * `common/rpc/rpc-exception.filter.ts`); handlers just delegate.
 */
@Controller()
export class FriendsTcpController {
  constructor(private readonly service: FriendsService) {}

  @MessagePattern({ cmd: TcpCmd.friends.request })
  request(
    @Payload()
    data: { requesterId: number; targetUsername: string; text?: string; _sys?: string },
  ) {
    return this.service.request({
      requesterId: data.requesterId,
      targetUsername: data.targetUsername,
      text: data.text,
    });
  }

  @MessagePattern({ cmd: TcpCmd.friends.accept })
  accept(@Payload() data: { userId: number; requestId: number; _sys?: string }) {
    return this.service.accept({ userId: data.userId, requestId: data.requestId });
  }

  @MessagePattern({ cmd: TcpCmd.friends.reject })
  reject(@Payload() data: { userId: number; requestId: number; _sys?: string }) {
    return this.service.reject({ userId: data.userId, requestId: data.requestId });
  }

  @MessagePattern({ cmd: TcpCmd.friends.remove })
  remove(@Payload() data: { userId: number; otherUserId: number; _sys?: string }) {
    return this.service.remove({ userId: data.userId, otherUserId: data.otherUserId });
  }

  @MessagePattern({ cmd: TcpCmd.friends.list })
  list(@Payload() data: { userId: number; _sys?: string }) {
    return this.service.list({ userId: data.userId });
  }

  @MessagePattern({ cmd: TcpCmd.friends.listPending })
  listPending(@Payload() data: { userId: number; _sys?: string }) {
    return this.service.listPending({ userId: data.userId });
  }
}
