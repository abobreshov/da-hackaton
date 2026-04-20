/**
 * RetentionScheduler.onModuleInit schedules the nightly prune via BullMQ
 * repeat. Tests assert the correct cron + jobId and that errors from the
 * queue are swallowed (logged only, not re-thrown).
 */

import { Logger } from '@nestjs/common';
import { RetentionScheduler } from './retention.scheduler';

describe('RetentionScheduler', () => {
  let queue: { add: jest.Mock };
  let logSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    queue = { add: jest.fn(async () => ({ id: 'x' })) };
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('schedules a repeatable job with the expected cron + jobId', async () => {
    const sched = new RetentionScheduler(queue as any);
    await sched.onModuleInit();

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [jobName, data, opts] = queue.add.mock.calls[0];
    expect(jobName).toBe('retention.prune.nightly');
    expect(typeof data.runId).toBe('number');
    expect(opts).toEqual({
      repeat: { pattern: '0 2 * * *' },
      jobId: 'retention.prune.nightly',
    });
    expect(logSpy).toHaveBeenCalled();
  });

  it('logs + swallows a queue.add failure (does not crash onModuleInit)', async () => {
    queue.add = jest.fn(async () => {
      throw new Error('redis unreachable');
    });
    const sched = new RetentionScheduler(queue as any);
    await expect(sched.onModuleInit()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('redis unreachable'));
  });

  it('handles non-Error rejections via String(err)', async () => {
    queue.add = jest.fn(async () => {
      // eslint-disable-next-line no-throw-literal
      throw 'raw-string';
    });
    const sched = new RetentionScheduler(queue as any);
    await expect(sched.onModuleInit()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('raw-string'));
  });
});
