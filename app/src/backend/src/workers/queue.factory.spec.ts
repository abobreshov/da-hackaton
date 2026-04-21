/**
 * Smoke tests for `createQueuePair`. BullMQ constructors are mocked to avoid
 * touching Redis; we only assert wiring + event-listener registration.
 */

jest.mock('bullmq', () => {
  const instances: any[] = [];
  class Queue {
    name: string;
    opts: any;
    constructor(name: string, opts: any) {
      this.name = name;
      this.opts = opts;
      (Queue as any).instances.push(this);
    }
    add = jest.fn(async (jobName: string, data: any) => ({ id: `job-${jobName}`, data }));
    close = jest.fn(async () => undefined);
  }
  (Queue as any).instances = [];

  class Worker {
    name: string;
    processor: any;
    opts: any;
    listeners: Record<string, Array<(...a: any[]) => void>> = {};
    constructor(name: string, processor: any, opts: any) {
      this.name = name;
      this.processor = processor;
      this.opts = opts;
      (Worker as any).instances.push(this);
    }
    on = jest.fn((event: string, fn: (...a: any[]) => void) => {
      (this.listeners[event] ||= []).push(fn);
      return this;
    });
    emit(event: string, ...args: any[]) {
      (this.listeners[event] ?? []).forEach((fn) => fn(...args));
    }
    close = jest.fn(async () => undefined);
  }
  (Worker as any).instances = [];

  class QueueEvents {
    name: string;
    opts: any;
    constructor(name: string, opts: any) {
      this.name = name;
      this.opts = opts;
      (QueueEvents as any).instances.push(this);
    }
    close = jest.fn(async () => undefined);
  }
  (QueueEvents as any).instances = [];

  return {
    Queue,
    Worker,
    QueueEvents,
    __reset: () => {
      (Queue as any).instances.length = 0;
      (Worker as any).instances.length = 0;
      (QueueEvents as any).instances.length = 0;
    },
  };
});

import {
  createQueuePair,
  DEFAULT_JOB_OPTIONS,
  DEFAULT_PROCESSOR_TIMEOUT_MS,
  DEFAULT_LOCK_DURATION_MS,
  DEFAULT_LOCK_RENEW_TIME_MS,
  withTimeout,
} from './queue.factory';

const bullmq = require('bullmq') as any;

describe('createQueuePair', () => {
  beforeEach(() => {
    bullmq.__reset();
  });

  it('returns a trio of queue + worker + events bound to the same name', () => {
    const processor = jest.fn(async () => ({ ok: true }));
    const conn = { host: 'localhost', port: 6379 } as any;
    const result = createQueuePair('test.queue', processor, conn);

    expect(result.queue).toBeDefined();
    expect(result.worker).toBeDefined();
    expect(result.events).toBeDefined();
    expect((result.queue as any).name).toBe('test.queue');
    expect((result.worker as any).name).toBe('test.queue');
    expect((result.events as any).name).toBe('test.queue');
  });

  it('passes DEFAULT_JOB_OPTIONS to the queue', () => {
    const processor = jest.fn(async () => undefined);
    const result = createQueuePair('q1', processor, {} as any);
    expect((result.queue as any).opts.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
  });

  it('registers failed + error listeners on the worker', () => {
    const processor = jest.fn(async () => undefined);
    const result = createQueuePair('q2', processor, {} as any);
    const listenerEvents = (result.worker as any).on.mock.calls.map((c: any[]) => c[0]);
    expect(listenerEvents).toEqual(expect.arrayContaining(['failed', 'error']));
  });

  it('failed listener tolerates undefined job without throwing', () => {
    const processor = jest.fn(async () => undefined);
    const result = createQueuePair('q3', processor, {} as any);
    // Invoke the `failed` listener directly via our mock emit
    expect(() => (result.worker as any).emit('failed', undefined, new Error('boom'))).not.toThrow();
  });

  it('failed listener logs attempt numbers when job is present', () => {
    const processor = jest.fn(async () => undefined);
    const result = createQueuePair('q4', processor, {} as any);
    const job = { id: 'j-1', attemptsMade: 2, opts: { attempts: 5 } };
    expect(() => (result.worker as any).emit('failed', job, new Error('x'))).not.toThrow();
  });

  it('error listener is registered and can be invoked', () => {
    const processor = jest.fn(async () => undefined);
    const result = createQueuePair('q5', processor, {} as any);
    expect(() => (result.worker as any).emit('error', new Error('runtime!'))).not.toThrow();
  });

  it('forwards extra worker options', () => {
    const processor = jest.fn(async () => undefined);
    const result = createQueuePair('q6', processor, { port: 1 } as any, { concurrency: 4 });
    expect((result.worker as any).opts).toMatchObject({ concurrency: 4 });
  });
});

describe('DEFAULT_JOB_OPTIONS', () => {
  it('has retry + cleanup settings the ops spec assumes', () => {
    expect(DEFAULT_JOB_OPTIONS).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: true,
      removeOnFail: { count: 1000 },
    });
  });
});

describe('worker lock + timeout wiring', () => {
  beforeEach(() => {
    bullmq.__reset();
  });

  it('sets lockDuration + lockRenewTime defaults on the worker', () => {
    const processor = jest.fn(async () => undefined);
    const result = createQueuePair('q.lock', processor, {} as any);
    expect((result.worker as any).opts).toMatchObject({
      lockDuration: DEFAULT_LOCK_DURATION_MS,
      lockRenewTime: DEFAULT_LOCK_RENEW_TIME_MS,
    });
    // sanity: renew strictly less than duration so renewal lands in time
    expect(DEFAULT_LOCK_RENEW_TIME_MS).toBeLessThan(DEFAULT_LOCK_DURATION_MS);
    // sanity: lockDuration >= 30s per the ops requirement
    expect(DEFAULT_LOCK_DURATION_MS).toBeGreaterThanOrEqual(30_000);
  });

  it('caller-supplied workerOptions can override lock fields', () => {
    const processor = jest.fn(async () => undefined);
    const result = createQueuePair('q.lock.override', processor, {} as any, {
      lockDuration: 99_000,
      lockRenewTime: 33_000,
    });
    expect((result.worker as any).opts).toMatchObject({
      lockDuration: 99_000,
      lockRenewTime: 33_000,
    });
  });

  it('wraps the processor so a slow job rejects after the configured timeout', async () => {
    const slow = jest.fn(
      () =>
        new Promise((resolve) => {
          const t = setTimeout(() => resolve('late'), 5_000);
          // Don't keep the test process alive past the timeout-rejection.
          if (typeof (t as any).unref === 'function') (t as any).unref();
        }),
    );
    const result = createQueuePair('q.timeout', slow as any, {} as any, {
      processorTimeoutMs: 50,
    } as any);
    const wrapped = (result.worker as any).processor;
    const fakeJob = { id: 'job-slow', data: {} };
    await expect(wrapped(fakeJob)).rejects.toThrow(/timed out/i);
    // underlying processor was actually invoked
    expect(slow).toHaveBeenCalled();
  });

  it('passes through processor result when it completes within budget', async () => {
    const fast = jest.fn(async () => ({ ok: true }));
    const result = createQueuePair('q.fast', fast as any, {} as any, {
      processorTimeoutMs: 1_000,
    } as any);
    const wrapped = (result.worker as any).processor;
    await expect(wrapped({ id: 'j', data: {} } as any)).resolves.toEqual({ ok: true });
  });

  it('uses DEFAULT_PROCESSOR_TIMEOUT_MS when no override given', async () => {
    expect(DEFAULT_PROCESSOR_TIMEOUT_MS).toBeGreaterThan(0);
    const fast = jest.fn(async () => 42);
    const result = createQueuePair('q.default-budget', fast as any, {} as any);
    const wrapped = (result.worker as any).processor;
    await expect(wrapped({ id: 'x', data: {} } as any)).resolves.toBe(42);
  });
});

describe('withTimeout', () => {
  it('resolves with the inner value when it beats the deadline', async () => {
    await expect(withTimeout(100, async () => 'fast')).resolves.toBe('fast');
  });

  it('rejects with a timeout error when the inner promise overruns', async () => {
    await expect(
      withTimeout(20, () => new Promise((r) => setTimeout(() => r('late'), 200))),
    ).rejects.toThrow(/timed out after 20ms/i);
  });

  it('propagates the inner rejection unchanged when it loses the race fast', async () => {
    await expect(
      withTimeout(100, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow(/boom/);
  });

  it('clears its timer so a fast resolve does not keep the loop alive', async () => {
    // If the timer leaked, jest would warn about pending handles. Smoke
    // by running many fast resolutions.
    await Promise.all(
      Array.from({ length: 20 }).map(() => withTimeout(1_000, async () => 1)),
    );
  });
});
