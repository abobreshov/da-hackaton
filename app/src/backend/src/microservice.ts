import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { env } from './config/environment';
import { buildTcpMicroserviceOptions } from './common/rpc-transport';
import { RpcExceptionFilter } from './common/rpc/rpc-exception.filter';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    buildTcpMicroserviceOptions(env.TCP_BIND, env.TCP_PORT),
  );

  // Global HttpException -> RpcException translation. Replaces the per-module
  // `toRpc` helpers that previously lived under `modules/*/rpc.util.ts` and
  // inline in `friends.tcp.ts` / `bans.tcp.ts`. The filter itself is a no-op
  // on HTTP contexts, so sharing via APP_FILTER on the hybrid HTTP services
  // (auth-service) stays safe. Here we register at bootstrap only because the
  // backend TCP entrypoint is microservice-only.
  app.useGlobalFilters(new RpcExceptionFilter());

  await app.listen();
  console.log(
    `Backend TCP microservice running on ${env.TCP_BIND}:${env.TCP_PORT} (TLS=${env.TLS_ENABLED})`,
  );
}

bootstrap();
