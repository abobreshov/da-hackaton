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

import { createQueuePair, DEFAULT_JOB_OPTIONS } from './queue.factory';
// eslint-disable-next-line @typescript-eslint/no-require-imports
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
