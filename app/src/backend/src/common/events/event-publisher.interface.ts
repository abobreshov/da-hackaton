/**
 * Port for post-commit event publication.
 *
 * Consumers (BansService, FriendsService, ModerationService, …) depend on
 * this interface via the `EVENT_PUBLISHER` DI token — not on a concrete
 * class — so EPIC-08 can swap `LoggingEventPublisher` for a Redis pub-sub
 * implementation without editing a single caller. Unit tests substitute a
 * mock and assert shape.
 *
 * `on()` was added for EPIC-06: in-process subscribers like
 * `AuditSubscriber` register handlers on domain events at
 * `onApplicationBootstrap`, and the producing services call `emit()`
 * without knowing who (if anyone) is listening.
 */
export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

export type EventHandler = (payload: unknown) => void | Promise<void>;

export interface IEventPublisher {
  emit(event: string, payload: unknown): void;
  on(event: string, handler: EventHandler): void;
}
