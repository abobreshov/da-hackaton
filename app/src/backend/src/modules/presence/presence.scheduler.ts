import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PresenceService } from './presence.service';

/**
 * PresenceScheduler — 10-second polling loop that drives the non-eager
 * half of EPIC-02 state changes:
 *   - "user went idle, tab still open"  → online → afk
 *   - "crashed client, no disconnect"    → afk/online → offline
 *
 * Online and disconnect-driven transitions are emitted eagerly by
 * `PresenceService.touch/disconnect` so they don't wait for this tick.
 *
 * The tick swallows errors deliberately — a single failed SCAN / MGET
 * must not take the loop down; the next tick will retry.
 */
@Injectable()
export class PresenceScheduler {
  private readonly logger = new Logger(PresenceScheduler.name);

  constructor(private readonly service: PresenceService) {}

  @Interval(10_000)
  async handleTick(): Promise<void> {
    try {
      await this.service.evaluate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`presence.evaluate tick failed: ${msg}`);
    }
  }
}
