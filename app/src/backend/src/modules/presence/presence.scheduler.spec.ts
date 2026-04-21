/**
 * PresenceScheduler (EPIC-02).
 *
 * Runs `PresenceService.evaluate()` on a fixed 10s cadence via
 * `@nestjs/schedule` `@Interval(10_000)`. Errors must be logged and
 * swallowed — a single failed tick must never propagate out and kill the
 * scheduler loop.
 */

jest.mock('../../config/environment', () => ({
  env: {
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    AFK_THRESHOLD_SECONDS: 60,
    PRESENCE_OFFLINE_THRESHOLD_SECONDS: 180,
  },
}));

import { Logger } from '@nestjs/common';
import { PresenceScheduler } from './presence.scheduler';
import type { PresenceService } from './presence.service';

describe('PresenceScheduler', () => {
  let service: jest.Mocked<PresenceService>;
  let scheduler: PresenceScheduler;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    service = { evaluate: jest.fn() } as unknown as jest.Mocked<PresenceService>;
    scheduler = new PresenceScheduler(service);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('handleTick delegates to service.evaluate()', async () => {
    service.evaluate.mockResolvedValue(undefined);
    await scheduler.handleTick();
    expect(service.evaluate).toHaveBeenCalledTimes(1);
  });

  it('swallows errors from evaluate() and logs a warning', async () => {
    service.evaluate.mockRejectedValue(new Error('redis down'));
    await expect(scheduler.handleTick()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('redis down'));
  });

  it('swallows non-Error rejections', async () => {
    service.evaluate.mockRejectedValue('boom');
    await expect(scheduler.handleTick()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('is decorated with @Interval(10000)', () => {
    // `SchedulerRegistry` metadata from @nestjs/schedule attaches to the
    // prototype method under the `SCHEDULE_*` reflect keys. We assert the
    // raw metadata is present so the harness will actually pick it up.
    const meta = Reflect.getMetadata(
      'SCHEDULE_INTERVAL_OPTIONS',
      PresenceScheduler.prototype.handleTick,
    );
    expect(meta).toBeDefined();
    expect(meta).toEqual(expect.objectContaining({ timeout: 10_000 }));
  });
});
