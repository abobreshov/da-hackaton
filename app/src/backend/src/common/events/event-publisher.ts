import { Injectable, Logger } from '@nestjs/common';
import { IEventPublisher } from './event-publisher.interface';

/**
 * Default `IEventPublisher` implementation — log-only.
 *
 * Thin stub for post-commit event publishing. Today it only logs; EPIC-08
 * (realtime / Redis pub-sub wiring) will replace this with a real publisher
 * without touching callers because they inject the `EVENT_PUBLISHER` token
 * (interface) and never the concrete class. Kept intentionally minimal so
 * unit tests can swap it with `{ emit: jest.fn() }` via DI without pulling
 * in `@nestjs/event-emitter`.
 */
@Injectable()
export class LoggingEventPublisher implements IEventPublisher {
  private readonly logger = new Logger(LoggingEventPublisher.name);

  emit(name: string, payload: unknown): void {
    // Fire-and-forget: downstream Redis pub/sub wiring lands in EPIC-08.
    this.logger.debug(`event.emit ${name} ${JSON.stringify(payload)}`);
  }
}

/**
 * Backward-compat alias. Prefer injecting `EVENT_PUBLISHER` + typing the dep
 * as `IEventPublisher`; the concrete class is only exported for tests that
 * want to instantiate the default impl directly.
 */
export const EventPublisher = LoggingEventPublisher;
export type EventPublisher = LoggingEventPublisher;
