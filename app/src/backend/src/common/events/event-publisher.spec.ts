/**
 * EventPublisher is a deliberately thin stub (see class docblock). Tests here
 * lock in its current log-only behavior + contract so callers can rely on
 * `.emit(name, payload)` being side-effect-free today and injectable via DI.
 *
 * Per oop-review: the concrete `LoggingEventPublisher` is the default impl of
 * the `IEventPublisher` port. Callers depend on the interface via the
 * `EVENT_PUBLISHER` token so EPIC-08 can swap in a Redis publisher without
 * editing consumers. `EventPublisher` is preserved as a backward-compat alias.
 */

import { Logger } from '@nestjs/common';
import {
  EventPublisher,
  LoggingEventPublisher,
} from './event-publisher';
import { EVENT_PUBLISHER, IEventPublisher } from './event-publisher.interface';

describe('LoggingEventPublisher', () => {
  let debug: jest.SpyInstance;

  beforeEach(() => {
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    debug.mockRestore();
  });

  it('exports a DI token symbol distinct from the class', () => {
    expect(typeof EVENT_PUBLISHER).toBe('symbol');
    expect(EVENT_PUBLISHER.toString()).toContain('EVENT_PUBLISHER');
  });

  it('LoggingEventPublisher instance satisfies IEventPublisher at compile + runtime', () => {
    const pub: IEventPublisher = new LoggingEventPublisher();
    expect(typeof pub.emit).toBe('function');
    // `.emit` is arity 2 (name, payload).
    expect(pub.emit.length).toBe(2);
  });

  it('EventPublisher is a backward-compat alias for LoggingEventPublisher', () => {
    expect(EventPublisher).toBe(LoggingEventPublisher);
    const pub = new EventPublisher();
    expect(pub).toBeInstanceOf(LoggingEventPublisher);
  });

  it('emit(name, payload) logs a debug message containing the name and JSON payload', () => {
    const pub = new LoggingEventPublisher();
    pub.emit('friend.request.new', { fromUserId: 1, toUserId: 2 });

    expect(debug).toHaveBeenCalledTimes(1);
    const msg = debug.mock.calls[0][0] as string;
    expect(msg).toContain('event.emit');
    expect(msg).toContain('friend.request.new');
    expect(msg).toContain('"fromUserId":1');
    expect(msg).toContain('"toUserId":2');
  });

  it('emit(name, payload) returns void and does not throw for a variety of payload shapes', () => {
    const pub = new LoggingEventPublisher();

    // Primitives + objects + null are all serializable via JSON.stringify.
    expect(() => pub.emit('a', null)).not.toThrow();
    expect(() => pub.emit('b', 42)).not.toThrow();
    expect(() => pub.emit('c', 'string')).not.toThrow();
    expect(() => pub.emit('d', [1, 2, 3])).not.toThrow();
    expect(() => pub.emit('e', { nested: { k: 'v' } })).not.toThrow();

    expect(debug).toHaveBeenCalledTimes(5);
    const names = debug.mock.calls.map((c) => c[0]);
    expect(names.some((n: string) => n.includes('event.emit a'))).toBe(true);
    expect(names.some((n: string) => n.includes('event.emit e'))).toBe(true);
  });

  it('multiple subscribers can emit independently (no shared state)', () => {
    const a = new LoggingEventPublisher();
    const b = new LoggingEventPublisher();
    a.emit('x', { from: 'a' });
    b.emit('x', { from: 'b' });
    expect(debug).toHaveBeenCalledTimes(2);
  });

  it('a custom mock publisher also satisfies IEventPublisher (DI substitutability)', () => {
    // This is the pattern used by bans.service.spec / friends.service.spec —
    // callers type the dep as IEventPublisher and pass `{ emit: jest.fn() }`
    // without touching the logger. Lock in that shape at the interface level.
    const emit = jest.fn();
    const mock: IEventPublisher = { emit };

    mock.emit('ban.user', { a: 1, b: 2 });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('ban.user', { a: 1, b: 2 });
    // The real logger must NOT be touched when a custom impl is injected.
    expect(debug).not.toHaveBeenCalled();
  });
});
