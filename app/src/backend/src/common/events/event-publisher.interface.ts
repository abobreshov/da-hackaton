/**
 * Port for post-commit event publication.
 *
 * Consumers (BansService, FriendsService, …) depend on this interface via the
 * `EVENT_PUBLISHER` DI token — not on a concrete class — so EPIC-08 can swap
 * `LoggingEventPublisher` for a Redis pub-sub implementation without editing
 * a single caller. Unit tests substitute a `jest.fn()` and assert shape.
 */
export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

export interface IEventPublisher {
  emit(event: string, payload: unknown): void;
}
