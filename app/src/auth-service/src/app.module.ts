import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './cache/cache.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthController } from './modules/health/health.controller';
import { SystemKeyRpcGuard } from './common/rpc-transport';
import { RpcExceptionFilter } from './common/rpc/rpc-exception.filter';

@Module({
  imports: [
    // /metrics endpoint — default path (`/metrics`) + default Node + process
    // metrics enabled out of the box. main.ts excludes /metrics from the
    // global `api/v1` prefix so Prometheus can scrape at the root path
    // declared in app/observability/prometheus.yml.
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),
    DatabaseModule,
    CacheModule,
    AuthModule,
  ],
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
