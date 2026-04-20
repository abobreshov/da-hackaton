import * as fs from 'node:fs';
import { MicroserviceOptions, Transport, RpcException } from '@nestjs/microservices';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { env } from '../config/environment';

export interface RpcEnvelope {
  _sys?: string;
  [key: string]: unknown;
}

function tlsServerOptions() {
  if (!env.TLS_ENABLED) return undefined;
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
