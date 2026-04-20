import { Global, Module } from '@nestjs/common';
import { ClientsModule, Transport, ClientProviderOptions } from '@nestjs/microservices';
import * as fs from 'node:fs';
import { env } from '../../../config/environment';

export const BACKEND_SERVICE = 'BACKEND_SERVICE';

function tlsClientOptions() {
  if (!env.TLS_ENABLED) return undefined;
  return {
    ca: fs.readFileSync(env.TLS_CA_PATH!),
    cert: fs.readFileSync(env.TLS_CERT_PATH!),
    key: fs.readFileSync(env.TLS_KEY_PATH!),
    rejectUnauthorized: true,
  };
}

const tls = tlsClientOptions();
const backendClient: ClientProviderOptions = {
  name: BACKEND_SERVICE,
  transport: Transport.TCP,
  options: tls
    ? { host: env.BACKEND_TCP_HOST, port: env.BACKEND_TCP_PORT, tlsOptions: tls }
    : { host: env.BACKEND_TCP_HOST, port: env.BACKEND_TCP_PORT },
};

@Global()
@Module({
  imports: [ClientsModule.register([backendClient])],
  exports: [ClientsModule],
})
export class BackendClientModule {}
