import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { env } from './config/environment';
import { buildTcpMicroserviceOptions } from './common/rpc-transport';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    buildTcpMicroserviceOptions(env.TCP_BIND, env.TCP_PORT),
  );

  await app.listen();
  console.log(
    `Backend TCP microservice running on ${env.TCP_BIND}:${env.TCP_PORT} (TLS=${env.TLS_ENABLED})`,
  );
}

bootstrap();
