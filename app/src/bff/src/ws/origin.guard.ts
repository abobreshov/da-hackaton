import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { resolveAllowedWsOrigins } from '../config/environment';

/**
 * WebSocket Origin guard. Rejects the handshake (and any subsequent guarded
 * event) with Socket.IO close code 4403 when the Origin header is missing or
 * not in the allow-list.
 *
 * Source of truth is {@link resolveAllowedWsOrigins} — the same resolver the
 * `@WebSocketGateway({cors:{origin}})` decorator consumes, so the upgrade
 * CORS check and the per-event guard cannot diverge. A previous version of
 * this guard read `process.env.ALLOWED_WS_ORIGINS` directly while the
 * gateway decorator inlined `process.env.ALLOWED_ORIGINS`, which produced
 * the symptom: socket connects, then disconnects on the first `room.join`.
 */
@Injectable()
export class WsOriginGuard implements CanActivate {
  private readonly logger = new Logger(WsOriginGuard.name);
  private readonly allowed: ReadonlySet<string>;

  constructor() {
    this.allowed = new Set(resolveAllowedWsOrigins());
  }

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<any>();
    const origin: string | undefined = client?.handshake?.headers?.origin;

    if (!origin || !this.allowed.has(origin)) {
      this.logger.warn(`WS handshake blocked — origin=${origin ?? '<missing>'} not in allow-list`);
      // Socket.IO reserves 4000–4999 for application-defined close codes.
      // 4403 = our "origin forbidden" signal; mirrors the REST 403 semantics.
      try {
        client?.disconnect?.(true);
      } catch {
        /* noop */
      }
      if (typeof client?.emit === 'function') {
        try {
          client.emit('error', { code: 4403, message: 'Origin not allowed' });
        } catch {
          /* noop */
        }
      }
      return false;
    }

    return true;
  }
}
