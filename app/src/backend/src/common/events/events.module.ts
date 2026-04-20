import { Global, Module } from '@nestjs/common';
import { LoggingEventPublisher } from './event-publisher';
import { EVENT_PUBLISHER } from './event-publisher.interface';

/**
 * Binds the `EVENT_PUBLISHER` port to its default impl (log-only). EPIC-08
 * swaps `useClass` to a Redis-backed publisher; consumers do not change.
 */
@Global()
@Module({
  providers: [{ provide: EVENT_PUBLISHER, useClass: LoggingEventPublisher }],
  exports: [EVENT_PUBLISHER],
})
export class EventsModule {}
