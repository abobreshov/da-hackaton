import { Module } from '@nestjs/common';
import { MicroserviceModule } from './common/microservice.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [MicroserviceModule, AuthModule, UsersModule],
  controllers: [HealthController],
})
export class AppModule {}
