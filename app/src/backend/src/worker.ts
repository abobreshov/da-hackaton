import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { QueueName } from '@app/contracts';
import { AppModule } from './app.module';
import { env } from './config/environment';

/**
 * Dedicated worker process entrypoint.
 *
 * Runs `AppModule` via `createApplicationContext` — no HTTP listener, no
 * TCP microservice. BullMQ queues/workers are activated by the
 * `WorkersModule.forRoot({ enabled: true })` gate (driven by
 * `WORKERS_ENABLED=true` in the process env).
 *
 * Isolating workers from the main backend keeps long-running retention /
 * cascade jobs from starving HTTP and inter-service RPC handlers.
 */
async function bootstrap() {
  const logger = new Logger('BackendWorker');

  if (env.WORKERS_ENABLED !== true) {
    // Fail loud — a silently-disabled worker process would look alive but
    // never process jobs, and retention would just silently stop.
    logger.error(
      'WORKERS_ENABLED must be true to start the backend worker process (got ' +
        String(env.WORKERS_ENABLED) +
        '). Set WORKERS_ENABLED=true on the backend-worker service.',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.enableShutdownHooks();

  const queues = [
    QueueName.userCascadeDelete,
    QueueName.retentionPrune,
    QueueName.attachmentsCleanup,
    QueueName.abuseReportNotify,
  ];
  logger.log(`Backend worker process running — queues: ${queues.join(', ')}`);

  // `enableShutdownHooks` wires SIGTERM/SIGINT to Nest lifecycle, which
  // triggers `WorkersModule.onModuleDestroy` → BullMQ closes workers,
  // events, queues, and the shared redis connection cleanly.
  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal} — closing worker process`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
   
  console.error('Backend worker failed to start:', err);
  process.exit(1);
});
