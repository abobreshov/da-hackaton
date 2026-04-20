import { Controller, HttpException } from '@nestjs/common';
import { MessagePattern, Payload, RpcException } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { FriendsService } from './friends.service';

/**
 * Convert HttpException (thrown by the service) into RpcException so callers
 * (BFF) receive a structured { status, message } envelope. See existing
 * auth-service RPC controllers for the pattern.
 */
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
export class FriendsTcpController {
  constructor(private readonly service: FriendsService) {}

  @MessagePattern({ cmd: TcpCmd.friends.request })
  request(
    @Payload()
    data: { requesterId: number; targetUsername: string; text?: string; _sys?: string },
  ) {
    return toRpc(() =>
      this.service.request({
        requesterId: data.requesterId,
        targetUsername: data.targetUsername,
        text: data.text,
      }),
    );
  }

  @MessagePattern({ cmd: TcpCmd.friends.accept })
  accept(@Payload() data: { userId: number; requestId: number; _sys?: string }) {
    return toRpc(() => this.service.accept({ userId: data.userId, requestId: data.requestId }));
  }

  @MessagePattern({ cmd: TcpCmd.friends.reject })
  reject(@Payload() data: { userId: number; requestId: number; _sys?: string }) {
    return toRpc(() => this.service.reject({ userId: data.userId, requestId: data.requestId }));
  }

  @MessagePattern({ cmd: TcpCmd.friends.remove })
  remove(@Payload() data: { userId: number; otherUserId: number; _sys?: string }) {
    return toRpc(() =>
      this.service.remove({ userId: data.userId, otherUserId: data.otherUserId }),
    );
  }
}
