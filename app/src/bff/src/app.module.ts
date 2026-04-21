import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import Redis from 'ioredis';
import { MicroserviceModule } from './common/microservice.module';
import { RpcProxyModule } from './common/proxy/rpc-proxy.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { MessagesModule } from './modules/messages/messages.module';
import { UnreadModule } from './modules/unread/unread.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { FriendsModule } from './modules/friends/friends.module';
import { BansModule } from './modules/bans/bans.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthController } from './modules/health/health.controller';
import { OriginGuard } from './common/guards/origin.guard';
import { REDIS_CLIENT } from './common/guards/throttle.guard';
import { WsModule } from './ws/ws.module';
import { env } from './config/environment';

/**
 * Global Redis client for rate-limit buckets (and future throttle needs).
 * ThrottleGuard declares REDIS_CLIENT as optional + fails-closed when
 * missing, so the client MUST be provided in every bootable environment.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (): Redis =>
        new Redis({
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          lazyConnect: false,
          maxRetriesPerRequest: 2,
          enableReadyCheck: true,
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Drain the ioredis client on process teardown so reconnect timers
   *  don't keep the Node event loop alive after Nest close. */
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (err) {
      this.logger.warn(
        `Redis quit failed, falling back to disconnect(): ${(err as Error)?.message}`,
      );
      this.redis.disconnect();
    }
  }
}

@Module({
  imports: [
    // /metrics endpoint — default path (`/metrics`) + default Node + process
    // metrics enabled out of the box. main.ts excludes /metrics from the
    // global `api/v1` prefix so Prometheus can scrape at the root path
    // declared in app/observability/prometheus.yml.
    PrometheusModule.register({ defaultMetrics: { enabled: true } }),
    RedisModule,
    MicroserviceModule,
    RpcProxyModule,
    AuthModule,
    UsersModule,
    RoomsModule,
    MessagesModule,
    UnreadModule,
    SessionsModule,
    AttachmentsModule,
    FriendsModule,
    BansModule,
    ModerationModule,
    ReportsModule,
    AuditModule,
    WsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: OriginGuard }],
})
export class AppModule {}
