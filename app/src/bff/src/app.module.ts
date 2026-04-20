import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MicroserviceModule } from './common/microservice.module';
import { RpcProxyModule } from './common/proxy/rpc-proxy.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { FriendsModule } from './modules/friends/friends.module';
import { BansModule } from './modules/bans/bans.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthController } from './modules/health/health.controller';
import { OriginGuard } from './common/guards/origin.guard';
import { WsModule } from './ws/ws.module';

@Module({
  imports: [
    MicroserviceModule,
    RpcProxyModule,
    AuthModule,
    UsersModule,
    RoomsModule,
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
