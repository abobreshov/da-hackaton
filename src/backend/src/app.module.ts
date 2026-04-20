import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AuthClientModule } from './common/auth-client.module';
import { UsersModule } from './modules/users/users.module';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [DatabaseModule, AuthClientModule, UsersModule],
  controllers: [HealthController],
})
export class AppModule {}
