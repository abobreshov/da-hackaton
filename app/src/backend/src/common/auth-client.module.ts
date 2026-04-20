import { Global, Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { env } from '../config/environment';
import { buildTcpClientOptions } from './rpc-transport';

export const AUTH_SERVICE = 'AUTH_SERVICE';

@Global()
@Module({
  imports: [
    ClientsModule.register([
      { name: AUTH_SERVICE, ...buildTcpClientOptions(env.AUTH_TCP_HOST, env.AUTH_TCP_PORT) },
    ]),
  ],
  exports: [ClientsModule],
})
export class AuthClientModule {}
