import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../../modules/audit/audit.module';
import { AuditSubscriber } from './audit-subscriber.service';
import { LoggingEventPublisher } from './event-publisher';
import { EVENT_PUBLISHER } from './event-publisher.interface';

/**
 * Binds the `EVENT_PUBLISHER` port to its default impl (in-process bus +
 * logging) and registers the EPIC-06 `AuditSubscriber` so privileged
 * domain events emitted by `ModerationService` / `AbuseReportsService`
 * are translated into `AuditService.append(...)` calls without those
 * services having to know the audit module exists.
 *
 * EPIC-08 swaps the publisher `useClass` to a Redis-backed impl; consumers
 * do not change because they bind to the `EVENT_PUBLISHER` token +
 * interface, not the concrete class.
 */
@Global()
@Module({
  imports: [AuditModule],
  providers: [
    { provide: EVENT_PUBLISHER, useClass: LoggingEventPublisher },
    AuditSubscriber,
  ],
  exports: [EVENT_PUBLISHER],
})
export class EventsModule {}
