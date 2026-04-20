import { Global, Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { env } from '../config/environment';

export const AUTH_SERVICE = 'AUTH_SERVICE';

@Global()
@Module({
  imports: [
    ClientsModule.register([
      {
        name: AUTH_SERVICE,
        transport: Transport.TCP,
        options: { host: env.AUTH_TCP_HOST, port: env.AUTH_TCP_PORT },
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class AuthClientModule {}
