import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './cache/cache.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthController } from './modules/health/health.controller';
import { SystemKeyRpcGuard } from './common/rpc-transport';
import { RpcExceptionFilter } from './common/rpc/rpc-exception.filter';

@Module({
  imports: [DatabaseModule, CacheModule, AuthModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: SystemKeyRpcGuard },
    // Global filter: translates HttpException -> RpcException on the TCP
    // boundary (no-op on HTTP contexts). Replaces the per-controller
    // `toRpc` helper that previously lived in `common/rpc-exception.util.ts`.
    { provide: APP_FILTER, useClass: RpcExceptionFilter },
  ],
})
export class AppModule {}
