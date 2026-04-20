import {
  DynamicModule,
  Global,
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
  Optional,
  type Provider,
} from '@nestjs/common';
import IORedis from 'ioredis';
import { QueueName } from '@app/contracts';
import type { Queue, QueueEvents, Worker } from 'bullmq';
import { env } from '../config/environment';
import type { Processor } from 'bullmq';
import { createQueuePair, type QueueFactoryResult } from './queue.factory';
import {
  ABUSE_REPORT_NOTIFY_QUEUE,
  ATTACHMENTS_CLEANUP_QUEUE,
  RETENTION_PRUNE_QUEUE,
  USER_CASCADE_DELETE_QUEUE,
  WORKERS_REDIS_CONNECTION,
  WORKERS_REGISTRY,
} from './queue.tokens';
import { userCascadeDeleteProcessor } from './processors/user-cascade-delete.processor';
import { retentionPruneProcessor } from './processors/retention-prune.processor';
import { attachmentsCleanupProcessor } from './processors/attachments-cleanup.processor';
import { abuseReportNotifyProcessor } from './processors/abuse-report-notify.processor';
import { RetentionScheduler } from './retention.scheduler';
import { QueueProducer } from './queue.producer';

interface WorkersRegistry {
  queues: Queue[];
  workers: Worker[];
  events: QueueEvents[];
}

const redisConnectionProvider: Provider = {
  provide: WORKERS_REDIS_CONNECTION,
  useFactory: (): IORedis => {
    // BullMQ requires `maxRetriesPerRequest: null` on the shared client
    // (blocking commands would otherwise error after a few retries).
    return new IORedis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      maxRetriesPerRequest: null,
    });
  },
};

/**
 * Build a queue+worker provider for one named queue.
 * The returned pair is also pushed onto the central registry for shutdown.
 */
function queuePairProvider(token: string, name: string, processor: Processor<any, any>): Provider {
  return {
    provide: token,
    inject: [WORKERS_REDIS_CONNECTION, WORKERS_REGISTRY],
    useFactory: (connection: IORedis, registry: WorkersRegistry): Queue => {
      const pair: QueueFactoryResult = createQueuePair(name, processor, connection);
      registry.queues.push(pair.queue);
      registry.workers.push(pair.worker);
      registry.events.push(pair.events);
      return pair.queue;
    },
  };
}

const registryProvider: Provider = {
  provide: WORKERS_REGISTRY,
  useFactory: (): WorkersRegistry => ({ queues: [], workers: [], events: [] }),
};

const queueProviders: Provider[] = [
  queuePairProvider(
    USER_CASCADE_DELETE_QUEUE,
    QueueName.userCascadeDelete,
    userCascadeDeleteProcessor,
  ),
  queuePairProvider(RETENTION_PRUNE_QUEUE, QueueName.retentionPrune, retentionPruneProcessor),
  queuePairProvider(
    ATTACHMENTS_CLEANUP_QUEUE,
    QueueName.attachmentsCleanup,
    attachmentsCleanupProcessor,
  ),
  queuePairProvider(
    ABUSE_REPORT_NOTIFY_QUEUE,
    QueueName.abuseReportNotify,
    abuseReportNotifyProcessor,
  ),
];

export interface WorkersModuleOptions {
  /**
   * When `true`, wire up BullMQ redis connection, queues, workers, scheduler,
   * and `QueueProducer` — the full worker host. When `false`, the module
   * provides nothing and imports nothing, so the process never opens a redis
   * connection or registers worker event loops. Use `true` only in a
   * dedicated worker process (see `src/worker.ts`); HTTP/TCP processes must
   * keep this `false` so queue jobs don't starve request handlers.
   */
  enabled: boolean;
}

/**
 * `WorkersModule` — BullMQ worker host for the backend.
 *
 * Gate with `WorkersModule.forRoot({ enabled: env.WORKERS_ENABLED })`.
 * When disabled, returns an empty global module (no providers, no exports,
 * no redis client) — queue work only runs in the dedicated `backend-worker`
 * process (`src/worker.ts`) so long-running retention / cascade jobs can't
 * block the HTTP/TCP event loop of the main backend service.
 */
@Global()
@Module({})
export class WorkersModule implements OnModuleDestroy {
  private readonly logger = new Logger(WorkersModule.name);

  constructor(
    @Optional() @Inject(WORKERS_REGISTRY) private readonly registry: WorkersRegistry | null = null,
    @Optional() @Inject(WORKERS_REDIS_CONNECTION) private readonly redis: IORedis | null = null,
  ) {}

  static forRoot(options: WorkersModuleOptions): DynamicModule {
    if (!options.enabled) {
      // Disabled host: nothing wired. The module still exists so `AppModule`
      // can import it unconditionally, but it contributes no providers,
      // no redis connection, and no worker event loops.
      return {
        module: WorkersModule,
        providers: [],
        exports: [],
      };
    }

    return {
      module: WorkersModule,
      providers: [
        registryProvider,
        redisConnectionProvider,
        ...queueProviders,
        RetentionScheduler,
        QueueProducer,
      ],
      exports: [
        QueueProducer,
        USER_CASCADE_DELETE_QUEUE,
        RETENTION_PRUNE_QUEUE,
        ATTACHMENTS_CLEANUP_QUEUE,
        ABUSE_REPORT_NOTIFY_QUEUE,
      ],
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.registry || !this.redis) return;
    this.logger.log('Shutting down BullMQ workers...');
    // Close workers first so they stop accepting jobs, then queues +
    // event listeners, then drop the shared redis connection.
    await Promise.all(this.registry.workers.map((w) => w.close()));
    await Promise.all(this.registry.events.map((e) => e.close()));
    await Promise.all(this.registry.queues.map((q) => q.close()));
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
    this.logger.log('BullMQ shutdown complete.');
  }
}
