import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import fastifyCookie from '@fastify/cookie';
import { AppModule } from './app.module';
import { RpcErrorInterceptor } from './common/interceptors/rpc-error.interceptor';
import { env } from './config/environment';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: { level: env.LOG_LEVEL as any } }),
  );

  await app.register(fastifyCookie as any, { secret: env.COOKIE_SECRET });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new RpcErrorInterceptor());

  app.enableCors({
    origin: env.ALLOWED_ORIGINS.split(','),
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  await app.listen(env.PORT, '0.0.0.0');
  console.log(`BFF running on port ${env.PORT}`);
}

bootstrap();
