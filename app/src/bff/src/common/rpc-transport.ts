import * as fs from 'node:fs';
import { ClientProvider, Transport } from '@nestjs/microservices';
import { env } from '../config/environment';

export function withSys<T extends object>(payload: T): T & { _sys: string } {
  return { ...payload, _sys: env.SYSTEM_KEY } as T & { _sys: string };
}

function tlsClientOptions() {
  if (!env.TLS_ENABLED) return undefined;
  return {
    ca: fs.readFileSync(env.TLS_CA_PATH!),
    cert: fs.readFileSync(env.TLS_CERT_PATH!),
    key: fs.readFileSync(env.TLS_KEY_PATH!),
    rejectUnauthorized: true,
  };
}

export function buildTcpClientOptions(host: string, port: number): ClientProvider {
  const tls = tlsClientOptions();
  return {
    transport: Transport.TCP,
    options: tls ? { host, port, tlsOptions: tls } : { host, port },
  };
}
