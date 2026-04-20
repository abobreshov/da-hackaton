import { Global, Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { env } from '../config/environment';

export const BACKEND_SERVICE = 'BACKEND_SERVICE';

@Global()
@Module({
  imports: [
    ClientsModule.register([
      {
        name: BACKEND_SERVICE,
        transport: Transport.TCP,
        options: { host: env.BACKEND_TCP_HOST, port: env.BACKEND_TCP_PORT },
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class MicroserviceModule {}
