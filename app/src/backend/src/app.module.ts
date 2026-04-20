import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { AuthClientModule } from './common/auth-client.module';
import { EventsModule } from './common/events/events.module';
import { UsersModule } from './modules/users/users.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { FriendsModule } from './modules/friends/friends.module';
import { BansModule } from './modules/bans/bans.module';
import { AuditModule } from './modules/audit/audit.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { AbuseReportsModule } from './modules/abuse-reports/abuse-reports.module';
import { HealthController } from './modules/health/health.controller';
import { SystemKeyRpcGuard } from './common/rpc-transport';
import { WorkersModule } from './workers/workers.module';

@Module({
  imports: [
    DatabaseModule,
    AuthClientModule,
    EventsModule,
    UsersModule,
    RoomsModule,
    FriendsModule,
    BansModule,
    AuditModule,
    ModerationModule,
    AbuseReportsModule,
    WorkersModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: SystemKeyRpcGuard }],
})
export class AppModule {}
