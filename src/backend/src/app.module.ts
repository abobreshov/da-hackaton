import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { UsersModule } from './modules/users/users.module';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [DatabaseModule, UsersModule],
  controllers: [HealthController],
})
export class AppModule {}
