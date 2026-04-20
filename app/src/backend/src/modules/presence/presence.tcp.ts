import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { PresenceService } from './presence.service';
import type { PresenceState } from '../transport/presence-publisher.service';

/**
 * PresenceTcpController — RPC surface called by the BFF's WS gateway.
 *
 * The three commands are best-effort heartbeat/bookkeeping, not domain
 * writes, so they don't typically throw HttpException. Any real infrastructure
 * error (Redis down) is swallowed one level up: the scheduler rides it out;
 * on the eager path, errors fall through to the global `RpcExceptionFilter`
 * which wraps them as RpcException({ status: 500, code: 'UPSTREAM_UNAVAILABLE' }).
 *
 * `stateOf` returns a `Record<userId, state>` instead of a Map because
 * NestJS microservice JSON encoding doesn't preserve Map semantics.
 */
@Controller()
export class PresenceTcpController {
  constructor(private readonly service: PresenceService) {}

  @MessagePattern({ cmd: TcpCmd.presence.touch })
  async touch(
    @Payload()
    data: {
      userId: number;
      sessionId: string;
      _sys?: string;
    },
  ): Promise<{ ok: true }> {
    await this.service.touch(data.userId, data.sessionId);
    return { ok: true };
  }

  @MessagePattern({ cmd: TcpCmd.presence.disconnect })
  async disconnect(
    @Payload()
    data: {
      userId: number;
      sessionId: string;
      _sys?: string;
    },
  ): Promise<{ ok: true }> {
    await this.service.disconnect(data.userId, data.sessionId);
    return { ok: true };
  }

  @MessagePattern({ cmd: TcpCmd.presence.stateOf })
  async stateOf(
    @Payload()
    data: {
      userIds: number[];
      _sys?: string;
    },
  ): Promise<{ states: Record<number, PresenceState> }> {
    const map = await this.service.stateOf(data.userIds);
    const states: Record<number, PresenceState> = {};
    for (const [userId, state] of map) {
      states[userId] = state;
    }
    return { states };
  }
}
