import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { env } from './config/environment';
import { buildTcpMicroserviceOptions } from './common/rpc-transport';

/**
 * Build the global ValidationPipe. Exported for unit-level inspection — the
 * pipe options MUST NOT include `forbidNonWhitelisted: true`, because the
 * shared-secret RPC envelope (`_sys`) rides along on every TCP payload and
 * would otherwise be rejected before the SystemKeyRpcGuard can read it.
 *
 * The assertion below is load-bearing: it fails loud at startup if someone
 * adds `forbidNonWhitelisted` in a future refactor.
 */
export const validationPipeOptions = {
  whitelist: true,
  transform: true,
} as const;

// Startup invariant — not a unit test, because bootstrap() pulls in the full
// Nest DI graph and is prohibitively expensive to mount just for a pipe
// config check. `console.assert` is cheap, runs on every boot, and keeps
// the signal where it matters: visible in service logs.
console.assert(
  !('forbidNonWhitelisted' in validationPipeOptions),
  'auth-service ValidationPipe MUST NOT set forbidNonWhitelisted — it would reject the `_sys` RPC envelope',
);

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: { level: 'info' } }),
  );

  // whitelist=true silently strips non-decorated props (including our `_sys` envelope key
  // after SystemKeyRpcGuard has already validated it). Do NOT enable forbidNonWhitelisted here —
  // it would reject TCP payloads that carry `_sys`.
  app.useGlobalPipes(new ValidationPipe(validationPipeOptions));

  app.enableCors({
    origin: env.ALLOWED_ORIGINS.split(','),
    credentials: true,
  });

  // Exclude `/metrics` from the global prefix — Prometheus scrapes at root
  // path (see app/observability/prometheus.yml).
  app.setGlobalPrefix('api/v1', { exclude: ['/metrics'] });

  app.connectMicroservice(buildTcpMicroserviceOptions(env.TCP_BIND, env.TCP_PORT));

  await app.startAllMicroservices();
  await app.listen(env.PORT, '0.0.0.0');
  console.log(
    `Auth service running on HTTP ${env.PORT} + TCP ${env.TCP_BIND}:${env.TCP_PORT} (TLS=${env.TLS_ENABLED})`,
  );
}

bootstrap();
