/**
 * EventPublisher is a deliberately thin stub (see class docblock). Tests here
 * lock in its current log-only behavior + contract so callers can rely on
 * `.emit(name, payload)` being side-effect-free today and injectable via DI.
 */

import { Logger } from '@nestjs/common';
import { EventPublisher } from './event-publisher';

describe('EventPublisher', () => {
  let debug: jest.SpyInstance;

  beforeEach(() => {
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    debug.mockRestore();
  });

  it('emit(name, payload) logs a debug message containing the name and JSON payload', () => {
    const pub = new EventPublisher();
    pub.emit('friend.request.new', { fromUserId: 1, toUserId: 2 });

    expect(debug).toHaveBeenCalledTimes(1);
    const msg = debug.mock.calls[0][0] as string;
    expect(msg).toContain('event.emit');
    expect(msg).toContain('friend.request.new');
    expect(msg).toContain('"fromUserId":1');
    expect(msg).toContain('"toUserId":2');
  });

  it('emit(name, payload) returns void and does not throw for a variety of payload shapes', () => {
    const pub = new EventPublisher();

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
    const a = new EventPublisher();
    const b = new EventPublisher();
    a.emit('x', { from: 'a' });
    b.emit('x', { from: 'b' });
    expect(debug).toHaveBeenCalledTimes(2);
  });
});
