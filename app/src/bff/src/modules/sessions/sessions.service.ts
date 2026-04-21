import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { BACKEND_SERVICE } from '../../common/microservice.module';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

export interface RevokeSessionInput {
  /** Session id (UUID, cookie-addressable). */
  sessionId: string;
  /** Owning user id; backend scopes revoke to prevent cross-user mutation. */
  userId: number;
}

/**
 * Thin BFF proxy for the backend's sessions module (EPIC-02 §2.2.4 / T26).
 *
 * Owns nothing beyond shape translation: the BFF takes the session-derived
 * `userId` and forwards to backend TCP. The backend decides what counts as
 * "active" (revoked rows excluded) and orders by `lastSeenAt DESC`. Revoke
 * is idempotent on the backend side and a no-op for sessions that don't
 * belong to `userId`, so we don't need to pre-validate ownership here.
 *
 * `recordLogin` lives on the same backend module but is only consumed by
 * auth-service at login time; the BFF deliberately does not expose it.
 */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(BACKEND_SERVICE) private readonly client: ClientProxy,
    private readonly proxy: RpcProxyService,
  ) {}

  listForUser(userId: number) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.sessions.listForUser }, { userId });
  }

  revoke(input: RevokeSessionInput) {
    // Backend `RevokePayload` reads `data.id` (not `sessionId`) — see
    // `backend/modules/sessions/sessions.tcp.ts`. Wire field MUST match or
    // the revoke silently no-ops (M5 review CRITICAL).
    return this.proxy.forward(
      this.client,
      { cmd: TcpCmd.sessions.revoke },
      { id: input.sessionId, userId: input.userId },
    );
  }
}
