import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { env } from '../config/environment';

/**
 * WebSocket Origin guard skeleton. Mount on the WS gateway once it lands.
 * Rejects the handshake with Socket.IO close code 4403 when the Origin
 * header is missing or not in ALLOWED_WS_ORIGINS.
 *
 * ALLOWED_WS_ORIGINS falls back to ALLOWED_ORIGINS when unset so the BFF
 * doesn't require a second env var during early bring-up.
 */
@Injectable()
export class WsOriginGuard implements CanActivate {
  private readonly logger = new Logger(WsOriginGuard.name);
  private readonly allowed: ReadonlySet<string>;

  constructor() {
    const raw =
      (process.env.ALLOWED_WS_ORIGINS && process.env.ALLOWED_WS_ORIGINS.length > 0
        ? process.env.ALLOWED_WS_ORIGINS
        : env.ALLOWED_ORIGINS) ?? '';
    this.allowed = new Set(
      raw
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    );
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
