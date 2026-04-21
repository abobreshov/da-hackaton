import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { env } from './config/environment';
import { buildTcpMicroserviceOptions } from './common/rpc-transport';
import { RpcExceptionFilter } from './common/rpc/rpc-exception.filter';

/**
 * Build the global ValidationPipe. Exported so a unit test (or a future
 * refactor) can inspect the options. The pipe MUST NOT include
 * `forbidNonWhitelisted: true` here — the backend HTTP surface is fronted
 * by the BFF whose callers may evolve to send extra fields, and there's no
 * benefit to crashing on them.
 */
export const validationPipeOptions = {
  whitelist: true,
  transform: true,
} as const;

console.assert(
  !('forbidNonWhitelisted' in validationPipeOptions),
  'backend ValidationPipe MUST NOT set forbidNonWhitelisted — keep the HTTP surface forward-compatible',
);

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: { level: env.LOG_LEVEL as any } }),
  );

  app.useGlobalPipes(new ValidationPipe(validationPipeOptions));

  app.enableCors({
    origin: env.ALLOWED_ORIGINS.split(','),
    credentials: true,
  });

  // Exclude `/metrics` from the global prefix — Prometheus scrapes at root
  // path (see app/observability/prometheus.yml).
  app.setGlobalPrefix('api/v1', { exclude: ['/metrics'] });

  app.connectMicroservice<MicroserviceOptions>(
    buildTcpMicroserviceOptions(env.TCP_BIND, env.TCP_PORT),
  );
  app.useGlobalFilters(new RpcExceptionFilter());

  await app.startAllMicroservices();
  await app.listen(env.PORT, '0.0.0.0');
  console.log(`Backend HTTP server running on port ${env.PORT}`);
  console.log(
    `Backend TCP microservice running on ${env.TCP_BIND}:${env.TCP_PORT} (TLS=${env.TLS_ENABLED})`,
  );
}

bootstrap();
