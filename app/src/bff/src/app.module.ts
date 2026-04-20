import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MicroserviceModule } from './common/microservice.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HealthController } from './modules/health/health.controller';
import { OriginGuard } from './common/guards/origin.guard';

@Module({
  imports: [MicroserviceModule, AuthModule, UsersModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: OriginGuard }],
})
export class AppModule {}
