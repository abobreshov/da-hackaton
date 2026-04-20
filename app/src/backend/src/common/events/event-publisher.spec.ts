/**
 * Tests the default `LoggingEventPublisher` impl of `IEventPublisher`:
 * (1) it still logs every emit as before, (2) it fans out to in-process
 * subscribers registered via `.on(name, handler)`, (3) misbehaving
 * handlers do not break other listeners or the emitting request flow.
 *
 * Callers depend on the interface via the `EVENT_PUBLISHER` token so
 * EPIC-08 can swap in a Redis publisher without editing consumers.
 * `EventPublisher` is preserved as a backward-compat alias.
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
    expect(pub.emit.length).toBe(2);
    expect(typeof pub.on).toBe('function');
    expect(pub.on.length).toBe(2);
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

  it('emit() safely logs a payload containing bigint values', () => {
    const pub = new LoggingEventPublisher();
    expect(() => pub.emit('report.create', { reportId: 7n, targetId: 100n })).not.toThrow();
    const msg = debug.mock.calls[0][0] as string;
    expect(msg).toContain('"reportId":"7"');
    expect(msg).toContain('"targetId":"100"');
  });

  it('multiple publisher instances have independent internal buses', () => {
    const a = new LoggingEventPublisher();
    const b = new LoggingEventPublisher();
    const handlerA = jest.fn();
    const handlerB = jest.fn();
    a.on('x', handlerA);
    b.on('x', handlerB);

    a.emit('x', { from: 'a' });
    expect(handlerA).toHaveBeenCalledWith({ from: 'a' });
    expect(handlerB).not.toHaveBeenCalled();
  });

  it('a custom mock publisher also satisfies IEventPublisher (DI substitutability)', () => {
    const emit = jest.fn();
    const on = jest.fn();
    const mock: IEventPublisher = { emit, on };

    mock.emit('ban.user', { a: 1, b: 2 });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('ban.user', { a: 1, b: 2 });
    expect(debug).not.toHaveBeenCalled();
  });

  it('on(name, handler) registers a subscriber that fires when emit(name, …) is called', () => {
    const pub = new LoggingEventPublisher();
    const handler = jest.fn();
    pub.on('room.ban', handler);

    pub.emit('room.ban', { roomId: 1, userId: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ roomId: 1, userId: 2 });
  });

  it('multiple subscribers on the same event each receive the payload', () => {
    const pub = new LoggingEventPublisher();
    const a = jest.fn();
    const b = jest.fn();
    pub.on('report.create', a);
    pub.on('report.create', b);

    pub.emit('report.create', { id: 7n });

    expect(a).toHaveBeenCalledWith({ id: 7n });
    expect(b).toHaveBeenCalledWith({ id: 7n });
  });

  it('a misbehaving sync handler does not break the emitter or other handlers', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      const pub = new LoggingEventPublisher();
      const good = jest.fn();
      pub.on('x', () => {
        throw new Error('boom');
      });
      pub.on('x', good);

      expect(() => pub.emit('x', { v: 1 })).not.toThrow();
      expect(good).toHaveBeenCalledWith({ v: 1 });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('a rejected async handler is logged and does not propagate', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      const pub = new LoggingEventPublisher();
      pub.on('x', async () => {
        throw new Error('async boom');
      });

      pub.emit('x', null);
      await Promise.resolve();
      await Promise.resolve();

      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
