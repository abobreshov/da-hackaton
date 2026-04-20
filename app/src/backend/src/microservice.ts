import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { env } from './config/environment';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.TCP,
    options: { host: '0.0.0.0', port: env.TCP_PORT },
  });

  await app.listen();
  console.log(`Backend TCP microservice running on port ${env.TCP_PORT}`);
}

bootstrap();
