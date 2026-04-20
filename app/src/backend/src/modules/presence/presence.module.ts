import {
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
  type Provider,
} from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import IORedis from 'ioredis';
import { env } from '../../config/environment';
import { PresenceService } from './presence.service';
import { PresenceScheduler } from './presence.scheduler';
import { PresenceTcpController } from './presence.tcp';
import { PRESENCE_REDIS } from './presence.tokens';

/**
 * PresenceModule — ephemeral presence bookkeeping (EPIC-02).
 *
 * Owns its own ioredis client (`PRESENCE_REDIS`) for HASH/STRING/SCAN
 * commands on `presence:*`. Consumes `PresencePublisher` from the global
 * `TransportModule` for the coalesced fan-out channel. Registers the
 * three `presence.*` TCP commands and a 10s scheduler tick.
 */
const redisProvider: Provider = {
  provide: PRESENCE_REDIS,
  useFactory: (): IORedis =>
    new IORedis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      lazyConnect: false,
    }),
};

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [PresenceTcpController],
  providers: [redisProvider, PresenceService, PresenceScheduler],
  exports: [PresenceService],
})
export class PresenceModule implements OnModuleDestroy {
  private readonly logger = new Logger(PresenceModule.name);

  constructor(@Inject(PRESENCE_REDIS) private readonly redis: IORedis) {}

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      try {
        this.redis.disconnect();
      } catch {
        /* swallow */
      }
    }
    this.logger.log('Presence Redis client closed.');
  }
}
