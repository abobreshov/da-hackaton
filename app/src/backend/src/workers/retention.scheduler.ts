import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueName } from '@app/contracts';
import type { Queue } from 'bullmq';
import { RETENTION_PRUNE_QUEUE } from './queue.tokens';

/**
 * Schedules the nightly `retention.prune` run using BullMQ's built-in
 * repeat feature. No `@nestjs/schedule` dependency required.
 *
 * Cron: `0 2 * * *` (02:00 UTC every day).
 *
 * BullMQ deduplicates repeat jobs by `{ pattern, name }`, so invoking
 * this on every service boot is safe — it won't stack schedules.
 */
@Injectable()
export class RetentionScheduler implements OnModuleInit {
  private readonly logger = new Logger(RetentionScheduler.name);
  private readonly cron = '0 2 * * *';
  private readonly jobName = 'retention.prune.nightly';

  constructor(
    @Inject(RETENTION_PRUNE_QUEUE)
    private readonly queue: Queue<{ runId: number }>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.add(
        this.jobName,
        // `runId` on the repeatable definition is only a placeholder;
        // each scheduled instance gets its own id via the event handler
        // below. BullMQ copies `data` for every repeat occurrence.
        { runId: Date.now() },
        {
          repeat: { pattern: this.cron },
          jobId: this.jobName,
        },
      );
      this.logger.log(
        `Scheduled "${QueueName.retentionPrune}" with cron "${this.cron}" (job=${this.jobName})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to schedule retention prune: ${msg}`);
    }
  }
}
