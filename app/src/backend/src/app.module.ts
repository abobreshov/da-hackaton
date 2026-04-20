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
import { MessagesModule } from './modules/messages/messages.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { UnreadModule } from './modules/unread/unread.module';
import { HealthController } from './modules/health/health.controller';
import { SystemKeyRpcGuard } from './common/rpc-transport';
import { WorkersModule } from './workers/workers.module';
import { TransportModule } from './modules/transport/transport.module';
import { PresenceModule } from './modules/presence/presence.module';
import { env } from './config/environment';

@Module({
  imports: [
    DatabaseModule,
    AuthClientModule,
    EventsModule,
    TransportModule,
    PresenceModule,
    UsersModule,
    RoomsModule,
    FriendsModule,
    BansModule,
    AuditModule,
    ModerationModule,
    AbuseReportsModule,
    MessagesModule,
    AttachmentsModule,
    UnreadModule,
    // Gated on WORKERS_ENABLED — the main HTTP/TCP backend runs with this
    // `false` so BullMQ workers don't share its event loop. A separate
    // `backend-worker` process (src/worker.ts) boots AppModule with
    // WORKERS_ENABLED=true to run the queue hosts.
    WorkersModule.forRoot({ enabled: env.WORKERS_ENABLED }),
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: SystemKeyRpcGuard }],
})
export class AppModule {}
