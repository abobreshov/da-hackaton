import { Module } from '@nestjs/common';
import { UnreadService } from './unread.service';
import { UnreadTcpController } from './unread.tcp';
import { DrizzleUnreadRepository } from './unread.repository';
import { UNREAD_REPOSITORY } from './unread.types';

/**
 * EPIC-09 — notifications + unread tracking. Pure backend feature; no
 * scheduler, no workers. TCP-only surface consumed by BFF HTTP routes
 * and the WS gateway (for `unread.changed` on new-message delivery).
 */
@Module({
  controllers: [UnreadTcpController],
  providers: [
    UnreadService,
    { provide: UNREAD_REPOSITORY, useClass: DrizzleUnreadRepository },
  ],
  exports: [UnreadService],
})
export class UnreadModule {}
