import * as fs from 'node:fs';
import { MicroserviceOptions, Transport, RpcException } from '@nestjs/microservices';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { env } from '../config/environment';

export interface RpcEnvelope {
  _sys?: string;
  [key: string]: unknown;
}

/**
 * Wrap an outbound TCP payload with the shared `_sys` system-key envelope so
 * the receiver's `SystemKeyRpcGuard` accepts it. Mirrors the helper in
 * `backend/src/common/rpc-transport.ts` and `bff/src/common/rpc-transport.ts`
 * — keeps every inter-service emit a one-line wrap instead of inlining
 * `{ _sys: env.SYSTEM_KEY, …payload }` at every call site.
 */
export function withSys<T extends object>(payload: T): T & { _sys: string } {
  return { ...payload, _sys: env.SYSTEM_KEY } as T & { _sys: string };
}

function assertTlsCerts(): void {
  const missing: string[] = [];
  for (const [label, p] of [
    ['TLS_CA_PATH', env.TLS_CA_PATH],
    ['TLS_CERT_PATH', env.TLS_CERT_PATH],
    ['TLS_KEY_PATH', env.TLS_KEY_PATH],
  ] as const) {
    if (!p || !fs.existsSync(p)) missing.push(`${label}=${p ?? '<unset>'}`);
  }
  if (missing.length) {
    throw new Error(
      `TLS_ENABLED=true but cert files are missing: ${missing.join(', ')}. ` +
        `Run \`./scripts/gen-certs.sh\` in app/ or set TLS_ENABLED=false to skip mTLS.`,
    );
  }
}

function tlsServerOptions() {
  if (!env.TLS_ENABLED) return undefined;
  assertTlsCerts();
  return {
    ca: fs.readFileSync(env.TLS_CA_PATH!),
    cert: fs.readFileSync(env.TLS_CERT_PATH!),
    key: fs.readFileSync(env.TLS_KEY_PATH!),
    requestCert: true,
    rejectUnauthorized: true,
  };
}

export function buildTcpMicroserviceOptions(host: string, port: number): MicroserviceOptions {
  const tls = tlsServerOptions();
  return {
    transport: Transport.TCP,
    options: tls ? { host, port, tlsOptions: tls } : { host, port },
  };
}

@Injectable()
export class SystemKeyRpcGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'rpc') return true;
    const data = ctx.switchToRpc().getData() as RpcEnvelope | undefined;
    const provided = data?._sys;
    if (!provided || provided !== env.SYSTEM_KEY) {
      throw new RpcException({ status: 401, message: 'Invalid or missing inter-service key' });
    }
    return true;
  }
}
