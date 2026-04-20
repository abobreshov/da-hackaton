import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import type IORedis from 'ioredis';
import { RedisChannel } from '@app/contracts';
import { TRANSPORT_REDIS_PUB } from './transport.tokens';

export type PresenceState = 'online' | 'afk' | 'offline';

interface PresenceDelta {
  userId: number;
  state: PresenceState;
}

/**
 * 500ms debounce/coalesce window — fixed cadence (not sliding). The first
 * `publish` after an idle period opens the window; subsequent publishes
 * within the window add to the in-flight batch without extending it. When
 * the window elapses the batch is emitted as a single Redis PUBLISH on
 * `RedisChannel.presenceGlobal` with payload `{ deltas: [...] }`.
 *
 * BFF does per-socket filtering (co-members ∪ friends); this provider does
 * not fan out per-user. See `mng/specs/03-realtime-transport.md` AC-03-07
 * and AC-03-11.
 */
const COALESCE_WINDOW_MS = 500;

@Injectable()
export class PresencePublisher implements OnModuleDestroy {
  private readonly logger = new Logger(PresencePublisher.name);

  /** Pending delta map, keyed by userId → latest state (last-write-wins). */
  private pending = new Map<number, PresenceState>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(TRANSPORT_REDIS_PUB) private readonly redis: IORedis,
  ) {}

  /**
   * Enqueue a presence delta. Does NOT publish synchronously. Within the
   * coalescing window (500ms), later calls for the same userId overwrite
   * the earlier state.
   */
  publish(userId: number, state: PresenceState): void {
    this.pending.set(userId, state);
    if (this.timer === null) {
      // First delta in a fresh window — schedule flush. `unref` so a
      // pending flush does not block process exit.
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, COALESCE_WINDOW_MS);
      if (typeof this.timer.unref === 'function') {
        this.timer.unref();
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.size > 0) {
      await this.flush();
    }
    try {
      await this.redis.quit();
    } catch {
      // ioredis.quit can reject if the connection is already closed —
      // in that case fall back to a forceful disconnect.
      try {
        this.redis.disconnect();
      } catch {
        /* swallow */
      }
    }
  }

  private async flush(): Promise<void> {
    if (this.pending.size === 0) return;

    const deltas: PresenceDelta[] = Array.from(
      this.pending,
      ([userId, state]) => ({ userId, state }),
    );
    this.pending.clear();

    const payload = JSON.stringify({ deltas });
    try {
      await this.redis.publish(RedisChannel.presenceGlobal, payload);
    } catch (err) {
      // Presence is best-effort: log and drop rather than crash the app
      // or retry (retries would just hand the BFF stale state anyway).
      this.logger.warn(
        `presence.publish failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
