import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { SessionsService } from './sessions.service';
import type { SessionRow } from './sessions.types';

/**
 * TCP surface for EPIC-02 §2.2.4 active sessions.
 *
 * - `sessions.recordLogin` is called from auth-service `CustomerAuthService`
 *   right after a successful login mints tokens. Payload carries optional
 *   `userAgent` + `ip` so a future BFF change can forward request metadata
 *   without bumping this contract.
 * - `sessions.listForUser` powers the FE active-sessions screen via the BFF.
 * - `sessions.revoke` is the per-row "log out this device" action; scoping
 *   to `userId` lives in the service so cross-user revokes are no-ops, not
 *   exceptions.
 *
 * `_sys` envelope is consumed by the global `SystemKeyRpcGuard`; handlers
 * destructure only the domain fields they need.
 */

interface RecordLoginPayload {
  userId: number;
  id?: string;
  userAgent?: string | null;
  ip?: string | null;
  _sys?: string;
}

interface ListForUserPayload {
  userId: number;
  _sys?: string;
}

interface RevokePayload {
  id: string;
  userId: number;
  _sys?: string;
}

interface IsRevokedPayload {
  sessionId: string;
  _sys?: string;
}

interface TouchPayload {
  sessionId: string;
  _sys?: string;
}

@Controller()
export class SessionsTcpController {
  constructor(private readonly service: SessionsService) {}

  @MessagePattern({ cmd: TcpCmd.sessions.recordLogin })
  recordLogin(@Payload() data: RecordLoginPayload): Promise<SessionRow> {
    return this.service.recordLogin({
      userId: data.userId,
      id: data.id,
      userAgent: data.userAgent ?? null,
      ip: data.ip ?? null,
    });
  }

  @MessagePattern({ cmd: TcpCmd.sessions.listForUser })
  async listForUser(@Payload() data: ListForUserPayload): Promise<{ sessions: SessionRow[] }> {
    const sessions = await this.service.listActive(data.userId);
    return { sessions };
  }

  @MessagePattern({ cmd: TcpCmd.sessions.revoke })
  revoke(@Payload() data: RevokePayload): Promise<{ revoked: boolean }> {
    return this.service.revoke({ id: data.id, userId: data.userId });
  }

  @MessagePattern({ cmd: TcpCmd.sessions.isRevoked })
  async isRevoked(@Payload() data: IsRevokedPayload): Promise<{ revoked: boolean }> {
    const revoked = await this.service.isRevoked(data.sessionId);
    return { revoked };
  }

  @MessagePattern({ cmd: TcpCmd.sessions.touch })
  touch(@Payload() data: TouchPayload): Promise<{ touched: boolean }> {
    return this.service.touch(data.sessionId);
  }
}
