import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './cache/cache.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [DatabaseModule, CacheModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
