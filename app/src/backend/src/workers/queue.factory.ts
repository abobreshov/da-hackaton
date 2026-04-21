import { Logger } from '@nestjs/common';
import {
  Queue,
  Worker,
  QueueEvents,
  type ConnectionOptions,
  type Processor,
  type JobsOptions,
  type WorkerOptions,
  type Job,
} from 'bullmq';

/**
 * Default job options applied to every queue created via this factory.
 *
 * Retry policy:
 *   - attempts: 5
 *   - exponential backoff starting at 2000ms
 *
 * Cleanup policy:
 *   - removeOnComplete: true (drop successful jobs immediately)
 *   - removeOnFail: keep up to 1000 failed jobs as a DLQ ring buffer.
 *     Once that cap is hit, older failures age out. Good balance between
 *     observability and bounded memory.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 2_000,
  },
  removeOnComplete: true,
  removeOnFail: {
    count: 1000,
  },
};

/**
 * Worker stall guard.
 *
 * `lockDuration` is how long BullMQ holds the lock for a single job before
 * it is considered stalled and re-queued. We pair it with a per-processor
 * `Promise.race` timeout below — `lockDuration` is the *floor* that BullMQ
 * itself enforces; `processorTimeoutMs` is the *ceiling* we enforce on the
 * processor body so a wedged DB query (e.g. retention seq-scan) doesn't
 * hold a worker thread indefinitely.
 *
 * Renewal time must be strictly less than the lock duration so the renew
 * tick lands before BullMQ would consider the job stalled. We pick half.
 */
export const DEFAULT_LOCK_DURATION_MS = 30_000;
export const DEFAULT_LOCK_RENEW_TIME_MS = 15_000;

/**
 * Default per-job wall-clock budget. Caller should override per queue
 * (see `WorkersModule`) — this default exists so unit tests + ad-hoc
 * `createQueuePair` callers get sane behaviour without configuration.
 */
export const DEFAULT_PROCESSOR_TIMEOUT_MS = 60_000;

export interface QueueFactoryResult<T = unknown, R = unknown> {
  queue: Queue<T, R>;
  worker: Worker<T, R>;
  events: QueueEvents;
}

/**
 * Caller-extensible WorkerOptions plus our processor-timeout knob.
 *
 * `processorTimeoutMs` is not a BullMQ option — it controls our own
 * `withTimeout` wrapper. Stripped before being forwarded to `new Worker`.
 */
export interface CreateQueuePairOptions extends Partial<WorkerOptions> {
  processorTimeoutMs?: number;
}

/**
 * Race a promise-returning function against a wall-clock deadline.
 *
 * On overrun, rejects with `Error('Processor timed out after <ms>ms')`.
 * Always clears the timer on settle so a fast-resolving inner promise
 * does not keep the event loop alive.
 *
 * Errors thrown by `fn` propagate unchanged (the `Promise.race` wrapper
 * resolves the rejection first; our timer is cleared in `finally`).
 */
export function withTimeout<T>(ms: number, fn: () => Promise<T> | T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Processor timed out after ${ms}ms`));
    }, ms);
  });
  // Wrap in Promise.resolve so synchronous throws from `fn` become rejections.
  const work = Promise.resolve().then(() => fn());
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Construct a BullMQ Queue + Worker pair bound to the same Redis connection.
 *
 * The caller supplies the queue name (should come from `@app/contracts`
 * `QueueName`) and a stub/real processor. The processor is wrapped in
 * `withTimeout(processorTimeoutMs, ...)` so an indefinitely-blocked job
 * (slow DB scan, FS hang) rejects after the configured wall clock and
 * BullMQ's normal retry/backoff kicks in. `lockDuration` + `lockRenewTime`
 * are also defaulted so the broker-side stall detector cannot diverge
 * from our processor budget.
 *
 * Returned objects are fully initialized; callers are responsible for
 * closing them (done centrally by `WorkersModule`).
 */
export function createQueuePair<T = unknown, R = unknown>(
  name: string,
  processor: Processor<T, R>,
  connection: ConnectionOptions,
  options: CreateQueuePairOptions = {},
): QueueFactoryResult<T, R> {
  const logger = new Logger(`Queue:${name}`);

  const { processorTimeoutMs = DEFAULT_PROCESSOR_TIMEOUT_MS, ...workerOptions } = options;

  const queue = new Queue<T, R>(name, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  const wrappedProcessor: Processor<T, R> = async (job: Job<T, R>, token?: string) => {
    return withTimeout(processorTimeoutMs, () => processor(job, token));
  };

  const worker = new Worker<T, R>(name, wrappedProcessor, {
    connection,
    lockDuration: DEFAULT_LOCK_DURATION_MS,
    lockRenewTime: DEFAULT_LOCK_RENEW_TIME_MS,
    ...workerOptions,
  });

  worker.on('failed', (job, err) => {
    logger.error(
      `Job ${job?.id ?? '<unknown>'} failed (attempt ${job?.attemptsMade ?? 0}/${
        job?.opts?.attempts ?? DEFAULT_JOB_OPTIONS.attempts
      }): ${err.message}`,
      err.stack,
    );
  });

  worker.on('error', (err) => {
    logger.error(`Worker runtime error: ${err.message}`, err.stack);
  });

  const events = new QueueEvents(name, { connection });

  return { queue, worker, events };
}
