import { Injectable, Logger } from '@nestjs/common';

/**
 * Thin stub for post-commit event publishing. Today it only logs; EPIC-08
 * (realtime / Redis pub-sub wiring) will replace this with a real publisher
 * without touching callers. Kept intentionally minimal so that unit tests can
 * swap it with `{ emit: jest.fn() }` via DI without pulling in `@nestjs/event-emitter`.
 */
@Injectable()
export class EventPublisher {
  private readonly logger = new Logger(EventPublisher.name);

  emit(name: string, payload: unknown): void {
    // Fire-and-forget: downstream Redis pub/sub wiring lands in EPIC-08.
    this.logger.debug(`event.emit ${name} ${JSON.stringify(payload)}`);
  }
}
