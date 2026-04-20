import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './cache/cache.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthController } from './modules/health/health.controller';
import { SystemKeyRpcGuard } from './common/rpc-transport';

@Module({
  imports: [DatabaseModule, CacheModule, AuthModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: SystemKeyRpcGuard }],
})
export class AppModule {}
