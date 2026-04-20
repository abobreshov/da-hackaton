import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { env } from './config/environment';
import { buildTcpMicroserviceOptions } from './common/rpc-transport';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: { level: 'info' } }),
  );

  // whitelist=true silently strips non-decorated props (including our `_sys` envelope key
  // after SystemKeyRpcGuard has already validated it). Do NOT enable forbidNonWhitelisted here —
  // it would reject TCP payloads that carry `_sys`.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.enableCors({
    origin: env.ALLOWED_ORIGINS.split(','),
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  app.connectMicroservice(buildTcpMicroserviceOptions(env.TCP_BIND, env.TCP_PORT));

  await app.startAllMicroservices();
  await app.listen(env.PORT, '0.0.0.0');
  console.log(
    `Auth service running on HTTP ${env.PORT} + TCP ${env.TCP_BIND}:${env.TCP_PORT} (TLS=${env.TLS_ENABLED})`,
  );
}

bootstrap();
