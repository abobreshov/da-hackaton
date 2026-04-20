import { Logger } from '@nestjs/common';
import {
  Queue,
  Worker,
  QueueEvents,
  type ConnectionOptions,
  type Processor,
  type JobsOptions,
  type WorkerOptions,
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

export interface QueueFactoryResult<T = unknown, R = unknown> {
  queue: Queue<T, R>;
  worker: Worker<T, R>;
  events: QueueEvents;
}

/**
 * Construct a BullMQ Queue + Worker pair bound to the same Redis connection.
 *
 * The caller supplies the queue name (should come from `@app/contracts`
 * `QueueName`) and a stub/real processor. Returned objects are fully
 * initialized; callers are responsible for closing them (done centrally
 * by `WorkersModule`).
 */
export function createQueuePair<T = unknown, R = unknown>(
  name: string,
  processor: Processor<T, R>,
  connection: ConnectionOptions,
  workerOptions: Partial<WorkerOptions> = {},
): QueueFactoryResult<T, R> {
  const logger = new Logger(`Queue:${name}`);

  const queue = new Queue<T, R>(name, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  const worker = new Worker<T, R>(name, processor, {
    connection,
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
