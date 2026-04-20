import { EventEmitter } from 'node:events';
import { Injectable, Logger } from '@nestjs/common';
import { EventHandler, IEventPublisher } from './event-publisher.interface';

/**
 * Default `IEventPublisher` implementation — logs every event AND fans
 * it out to in-process subscribers via Node's `EventEmitter`.
 *
 * The `EventEmitter` makes EPIC-06's `AuditSubscriber` possible without
 * pulling in `@nestjs/event-emitter`: subscribers register handlers via
 * `on(name, fn)` at `onApplicationBootstrap` and producer-side services
 * keep calling `emit(name, payload)` ignorant of who listens.
 *
 * EPIC-08 will swap this implementation for a Redis-backed publisher;
 * consumers do not change because they bind to the `EVENT_PUBLISHER`
 * token + `IEventPublisher` interface, not the concrete class.
 */
@Injectable()
export class LoggingEventPublisher implements IEventPublisher {
  private readonly logger = new Logger(LoggingEventPublisher.name);
  private readonly bus = new EventEmitter();

  constructor() {
    // Tolerate large numbers of listeners — every subscriber service may
    // register multiple events on this single bus.
    this.bus.setMaxListeners(0);
  }

  emit(name: string, payload: unknown): void {
    this.logger.debug(`event.emit ${name} ${safeStringify(payload)}`);
    try {
      this.bus.emit(name, payload);
    } catch (err) {
      this.logger.warn(
        `event.emit handler error for ${name}: ${(err as Error).message}`,
      );
    }
  }

  on(name: string, handler: EventHandler): void {
    this.bus.on(name, (payload: unknown) => {
      try {
        const ret = handler(payload);
        if (ret && typeof (ret as Promise<unknown>).catch === 'function') {
          (ret as Promise<unknown>).catch((err) =>
            this.logger.warn(
              `event handler rejected for ${name}: ${(err as Error).message}`,
            ),
          );
        }
      } catch (err) {
        this.logger.warn(
          `event handler threw for ${name}: ${(err as Error).message}`,
        );
      }
    });
  }
}

/**
 * Backward-compat alias. Prefer injecting `EVENT_PUBLISHER` + typing the dep
 * as `IEventPublisher`; the concrete class is only exported for tests that
 * want to instantiate the default impl directly.
 */
export const EventPublisher = LoggingEventPublisher;
export type EventPublisher = LoggingEventPublisher;

/**
 * JSON.stringify that coerces BigInt to string — event payloads carry
 * `bigint` ids (EPIC-06 `reportId`, `targetId`) and must not crash the
 * publisher's debug log.
 */
function safeStringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? val.toString() : val));
}
