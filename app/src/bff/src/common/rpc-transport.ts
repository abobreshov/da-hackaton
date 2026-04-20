import * as fs from 'node:fs';
import { ClientProvider, Transport } from '@nestjs/microservices';
import { env } from '../config/environment';

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

function tlsClientOptions() {
  if (!env.TLS_ENABLED) return undefined;
  assertTlsCerts();
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
