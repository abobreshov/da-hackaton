import { Module } from '@nestjs/common';
import { UnreadService } from './unread.service';
import { UnreadSubscriber } from './unread-subscriber.service';
import { UnreadTcpController } from './unread.tcp';
import { DrizzleUnreadRepository } from './unread.repository';
import { UNREAD_REPOSITORY } from './unread.types';
import { RoomsModule } from '../rooms/rooms.module';
import { MessagesModule } from '../messages/messages.module';

/**
 * EPIC-09 — notifications + unread tracking. Pure backend feature; no
 * scheduler, no workers. TCP-only surface consumed by BFF HTTP routes
 * and the WS gateway (for `unread.changed` on new-message delivery).
 *
 * `UnreadSubscriber` listens for `message.created` events from
 * `MessagesService` (AC-09-04) and translates them into per-recipient
 * `unread.changed` Redis PUBLISHes on `user:{id}`. It depends on
 * `RoomsService` to resolve room membership; the global `EventsModule`
 * and `TransportModule` provide the publisher port + Redis pub client.
 */
@Module({
  imports: [RoomsModule, MessagesModule],
  controllers: [UnreadTcpController],
  providers: [
    UnreadService,
    UnreadSubscriber,
    { provide: UNREAD_REPOSITORY, useClass: DrizzleUnreadRepository },
  ],
  exports: [UnreadService],
})
export class UnreadModule {}
