import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import Redis from 'ioredis';
import { MicroserviceModule } from './common/microservice.module';
import { RpcProxyModule } from './common/proxy/rpc-proxy.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { MessagesModule } from './modules/messages/messages.module';
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
class RedisModule implements OnApplicationShutdown {
  constructor() {}
  async onApplicationShutdown(): Promise<void> {}
}

@Module({
  imports: [
    RedisModule,
    MicroserviceModule,
    RpcProxyModule,
    AuthModule,
    UsersModule,
    RoomsModule,
    MessagesModule,
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
