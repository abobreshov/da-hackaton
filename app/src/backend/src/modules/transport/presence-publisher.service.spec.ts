/**
 * PresencePublisher (EPIC-03 AC-03-07 + AC-03-11).
 *
 * Contract:
 *   - `publish(userId, state)` enqueues a delta, does NOT PUBLISH immediately.
 *   - The service coalesces deltas within a 500 ms window and emits a single
 *     Redis PUBLISH to `RedisChannel.presenceGlobal` with payload
 *     `{ deltas: [{ userId, state }, ...] }`.
 *   - Later state for the same userId within the same window overwrites the
 *     earlier one (last-write-wins per user inside a window).
 *   - After the window flushes, the next `publish(...)` starts a fresh window.
 *   - On module shutdown, any pending delta is flushed synchronously (one
 *     final PUBLISH) so we don't drop state transitions on SIGTERM.
 *
 * The BFF owns the per-socket interest filter (co-members ∪ friends); this
 * provider does NOT fan out per-user — that's why we only publish to the
 * global coalesced channel.
 */

import { RedisChannel } from '@app/contracts';
import { PresencePublisher } from './presence-publisher.service';

function makeRedisPub() {
  return {
    publish: jest.fn(async (_channel: string, _payload: string) => 1),
    quit: jest.fn(async () => 'OK' as const),
    disconnect: jest.fn(),
  };
}

describe('PresencePublisher', () => {
  let redis: ReturnType<typeof makeRedisPub>;
  let publisher: PresencePublisher;

  beforeEach(() => {
    jest.useFakeTimers();
    redis = makeRedisPub();
    publisher = new PresencePublisher(redis as any);
  });

  afterEach(async () => {
    // Drain any pending timer so it doesn't leak into the next test.
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('publishes a coalesced delta to RedisChannel.presenceGlobal after 500ms', async () => {
    publisher.publish(42, 'online');

    // Nothing fires immediately — we debounce.
    expect(redis.publish).not.toHaveBeenCalled();

    jest.advanceTimersByTime(500);
    // Let any microtask scheduled inside the timer resolve.
    await Promise.resolve();

    expect(redis.publish).toHaveBeenCalledTimes(1);
    const [channel, rawPayload] = redis.publish.mock.calls[0];
    expect(channel).toBe(RedisChannel.presenceGlobal);
    const parsed = JSON.parse(rawPayload as string);
    expect(parsed).toEqual({ deltas: [{ userId: 42, state: 'online' }] });
  });

  it('coalesces multiple rapid publishes in the same window into a single PUBLISH', async () => {
    publisher.publish(1, 'online');
    publisher.publish(2, 'online');
    publisher.publish(3, 'afk');

    jest.advanceTimersByTime(499);
    expect(redis.publish).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await Promise.resolve();

    expect(redis.publish).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(redis.publish.mock.calls[0][1] as string);
    expect(parsed.deltas).toEqual(
      expect.arrayContaining([
        { userId: 1, state: 'online' },
        { userId: 2, state: 'online' },
        { userId: 3, state: 'afk' },
      ]),
    );
    expect(parsed.deltas).toHaveLength(3);
  });

  it('last-write-wins for the same userId inside a window', async () => {
    publisher.publish(7, 'online');
    publisher.publish(7, 'afk');
    publisher.publish(7, 'offline');

    jest.advanceTimersByTime(500);
    await Promise.resolve();

    expect(redis.publish).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(redis.publish.mock.calls[0][1] as string);
    expect(parsed.deltas).toEqual([{ userId: 7, state: 'offline' }]);
  });

  it('starts a fresh 500ms window after the previous one flushes', async () => {
    publisher.publish(1, 'online');
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    expect(redis.publish).toHaveBeenCalledTimes(1);

    // Idle. Next publish should debounce again, not fire instantly.
    publisher.publish(2, 'afk');
    expect(redis.publish).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(499);
    expect(redis.publish).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    await Promise.resolve();

    expect(redis.publish).toHaveBeenCalledTimes(2);
    const parsed2 = JSON.parse(redis.publish.mock.calls[1][1] as string);
    expect(parsed2).toEqual({ deltas: [{ userId: 2, state: 'afk' }] });
  });

  it('does not reset the window when additional publishes arrive mid-window (fixed 500ms cadence)', async () => {
    publisher.publish(1, 'online');

    jest.advanceTimersByTime(300);
    publisher.publish(2, 'online');

    jest.advanceTimersByTime(200); // 500ms total since the first publish
    await Promise.resolve();

    expect(redis.publish).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(redis.publish.mock.calls[0][1] as string);
    expect(parsed.deltas).toEqual(
      expect.arrayContaining([
        { userId: 1, state: 'online' },
        { userId: 2, state: 'online' },
      ]),
    );
    expect(parsed.deltas).toHaveLength(2);
  });

  it('flushes pending delta synchronously on module shutdown', async () => {
    publisher.publish(99, 'offline');
    expect(redis.publish).not.toHaveBeenCalled();

    await publisher.onModuleDestroy();

    expect(redis.publish).toHaveBeenCalledTimes(1);
    const [channel, rawPayload] = redis.publish.mock.calls[0];
    expect(channel).toBe(RedisChannel.presenceGlobal);
    const parsed = JSON.parse(rawPayload as string);
    expect(parsed).toEqual({ deltas: [{ userId: 99, state: 'offline' }] });
  });

  it('onModuleDestroy with no pending deltas does not PUBLISH', async () => {
    await publisher.onModuleDestroy();
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('onModuleDestroy quits the redis pub client so the process can exit cleanly', async () => {
    await publisher.onModuleDestroy();
    expect(redis.quit).toHaveBeenCalledTimes(1);
  });

  it('onModuleDestroy cancels any pending timer (no late publish after shutdown)', async () => {
    publisher.publish(5, 'online');
    await publisher.onModuleDestroy();
    expect(redis.publish).toHaveBeenCalledTimes(1);

    // Any leftover timer would double-fire here. Advance past the window and
    // confirm nothing new is published.
    jest.advanceTimersByTime(10_000);
    await Promise.resolve();
    expect(redis.publish).toHaveBeenCalledTimes(1);
  });
});
