/**
 * DI tokens for BullMQ queues.
 *
 * Each token maps to a provider that supplies a fully-constructed
 * `Queue` instance for the corresponding named queue. Workers for
 * these queues are registered internally by `WorkersModule`; consumers
 * only interact with queues via the producer helpers (see
 * `queue.producer.ts`) or by injecting these tokens directly.
 */

export const USER_CASCADE_DELETE_QUEUE = 'USER_CASCADE_DELETE_QUEUE';
export const RETENTION_PRUNE_QUEUE = 'RETENTION_PRUNE_QUEUE';
export const ATTACHMENTS_CLEANUP_QUEUE = 'ATTACHMENTS_CLEANUP_QUEUE';
export const ABUSE_REPORT_NOTIFY_QUEUE = 'ABUSE_REPORT_NOTIFY_QUEUE';

export const WORKERS_REDIS_CONNECTION = 'WORKERS_REDIS_CONNECTION';

/** Internal token holding the list of Worker instances for graceful shutdown. */
export const WORKERS_REGISTRY = 'WORKERS_REGISTRY';
