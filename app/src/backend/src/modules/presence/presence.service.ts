import { Inject, Injectable } from '@nestjs/common';
import type IORedis from 'ioredis';
import { RedisKey } from '@app/contracts';
import { env } from '../../config/environment';
import { PresencePublisher, type PresenceState } from '../transport/presence-publisher.service';
import { PRESENCE_REDIS } from './presence.tokens';

/**
 * PresenceService — single writer for presence state across the backend
 * (see EPIC-02 AC-02-09, ADR-001).
 *
 * Responsibilities:
 *   - Maintain the `presence:sessions:{userId}` HASH of `{sessionId → ts}`
 *     on every heartbeat + disconnect.
 *   - Derive presence state (`online | afk | offline`) from HASH freshness
 *     against `AFK_THRESHOLD_SECONDS`.
 *   - Persist the derived state to `presence:state:{userId}` with a 90s TTL
 *     safety net for crashed schedulers / Redis evictions.
 *   - Emit eager deltas via `PresencePublisher` on every real transition so
 *     the ≤2s propagation SLA (AC-02-08) is met without waiting for the
 *     10s scheduler tick.
 *
 * What lives where:
 *   - Eager path (this file) handles `new user → online`, `afk → online`,
 *     `last session gone → offline`, disconnect-driven `stale → afk`.
 *   - Scheduler (`presence.scheduler.ts`) handles idle-to-AFK transitions
 *     and cleanup of crashed-client HASHes that no longer get touched.
 *
 * Safety net: `presence:state:{userId}` STRING carries a 90s TTL so a
 * scheduler crash during an AFK window still drops the state within ~2x
 * the tick cadence. Every touch refreshes the TTL.
 */
@Injectable()
export class PresenceService {
  /** Safety-net TTL on the derived state STRING (seconds). */
  private readonly STATE_TTL_SECONDS = 90;
  private readonly afkThresholdMs = env.AFK_THRESHOLD_SECONDS * 1_000;
  /**
   * Session entries older than this are treated as dead — both excluded
   * from `derive()` and HDEL'd in `evaluate()`. Without this bound a
   * crashed client (laptop lid / `kill -9` / network drop, no clean
   * `presence.disconnect` delivered) would leave its HASH entry in Redis
   * indefinitely and the user would stay `afk` forever.
   */
  private readonly offlineThresholdMs = env.PRESENCE_OFFLINE_THRESHOLD_SECONDS * 1_000;

  constructor(
    @Inject(PRESENCE_REDIS) private readonly redis: IORedis,
    private readonly publisher: PresencePublisher,
  ) {}

  /**
   * Record a heartbeat from one session. Writes the HASH entry, re-derives
   * state, and eager-publishes on transition.
   */
  async touch(userId: number, sessionId: string): Promise<void> {
    const now = Date.now();
    const hashKey = RedisKey.presenceSessions(userId);
    const stateKey = RedisKey.presenceState(userId);

    await this.redis.hset(hashKey, sessionId, String(now));

    const [prevState, sessions] = await Promise.all([
      this.redis.get(stateKey),
      this.redis.hgetall(hashKey),
    ]);

    const nextState = this.derive(sessions, now);

    if (nextState !== prevState) {
      await this.writeState(userId, nextState);
      this.publisher.publish(userId, nextState);
    } else if (nextState !== 'offline') {
      // Refresh TTL on the safety-net key without changing state/publishing.
      await this.redis.expire(stateKey, this.STATE_TTL_SECONDS);
    }
  }

  /**
   * Remove a session on WS disconnect. Covers AC-02-10: last session gone
   * → offline ≤2s without waiting for the TTL / scheduler.
   */
  async disconnect(userId: number, sessionId: string): Promise<void> {
    const hashKey = RedisKey.presenceSessions(userId);
    const stateKey = RedisKey.presenceState(userId);

    await this.redis.hdel(hashKey, sessionId);

    const [prevState, sessions] = await Promise.all([
      this.redis.get(stateKey),
      this.redis.hgetall(hashKey),
    ]);

    const nextState = this.derive(sessions, Date.now());

    if (nextState === prevState) return;

    if (nextState === 'offline') {
      await this.redis.del(stateKey);
    } else {
      await this.writeState(userId, nextState);
    }
    this.publisher.publish(userId, nextState);
  }

  /**
   * Batch lookup for per-user presence state. Missing / unknown values fall
   * back to `'offline'` so callers never have to handle nulls.
   */
  async stateOf(userIds: number[]): Promise<Map<number, PresenceState>> {
    const result = new Map<number, PresenceState>();
    if (userIds.length === 0) return result;

    const keys = userIds.map((id) => RedisKey.presenceState(id));
    const values = await this.redis.mget(...keys);
    for (let i = 0; i < userIds.length; i++) {
      result.set(userIds[i], this.normalize(values[i]));
    }
    return result;
  }

  /**
   * Scheduler tick. SCANs presence:sessions:* and handles only the states
   * the eager path can't observe:
   *   - freshest ts older than AFK threshold → afk (user went idle while
   *     the tab stayed open).
   *   - HASH empty / all entries stale beyond safety horizon → offline
   *     (crashed client, no `presence.disconnect` was delivered).
   */
  async evaluate(): Promise<void> {
    const now = Date.now();
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        RedisKey.presenceSessions('*' as unknown as number),
        'COUNT',
        100,
      );
      cursor = nextCursor;

      for (const hashKey of keys as string[]) {
        const userId = this.userIdFromHashKey(hashKey);
        if (userId === null) continue;

        // Prune entries older than the offline threshold BEFORE deriving.
        // This is what flips a crashed client from afk → offline: without
        // the prune the HASH entry lingers, `derive()` sees ≥1 entry,
        // returns afk, and the user is stuck there forever.
        await this.pruneStaleEntries(hashKey, now);

        const [prevState, sessions] = await Promise.all([
          this.redis.get(RedisKey.presenceState(userId)),
          this.redis.hgetall(hashKey),
        ]);

        const nextState = this.derive(sessions, now);
        if (nextState === prevState) continue;

        if (nextState === 'offline') {
          await this.redis.del(RedisKey.presenceState(userId));
          // The HASH is empty at this point; drop the key so the next
          // SCAN doesn't keep tripping over an empty shell.
          await this.redis.del(hashKey);
        } else {
          await this.writeState(userId, nextState);
        }
        this.publisher.publish(userId, nextState);
      }
    } while (cursor !== '0');
  }

  /**
   * HDEL every session entry in the HASH whose timestamp is older than
   * `offlineThresholdMs`. Runs inside `evaluate()` but is split out so
   * the intent is obvious — this is the crashed-client eviction path,
   * not domain logic.
   */
  private async pruneStaleEntries(hashKey: string, now: number): Promise<void> {
    const sessions = await this.redis.hgetall(hashKey);
    const dead: string[] = [];
    for (const [sessionId, tsRaw] of Object.entries(sessions)) {
      const ts = Number(tsRaw);
      if (!Number.isFinite(ts) || now - ts > this.offlineThresholdMs) {
        dead.push(sessionId);
      }
    }
    if (dead.length > 0) await this.redis.hdel(hashKey, ...dead);
  }

  /**
   * Core derivation rule:
   *   - any session ts within the AFK window → online
   *   - at least one session within the offline window (but stale past
   *     AFK) → afk
   *   - empty HASH / every entry past the offline window → offline
   *
   * The offline-window check keeps the read path in sync with the
   * scheduler's prune pass — a read that lands in the ≈10 s gap between
   * ticks still sees the user as offline instead of lingering on afk.
   */
  private derive(sessions: Record<string, string>, now: number): PresenceState {
    const entries = Object.values(sessions);
    if (entries.length === 0) return 'offline';

    let freshest = -Infinity;
    for (const ts of entries) {
      const parsed = Number(ts);
      if (Number.isFinite(parsed) && parsed > freshest) freshest = parsed;
    }

    if (freshest === -Infinity) return 'offline';
    const age = now - freshest;
    if (age <= this.afkThresholdMs) return 'online';
    if (age > this.offlineThresholdMs) return 'offline';
    return 'afk';
  }

  private normalize(raw: string | null | undefined): PresenceState {
    if (raw === 'online' || raw === 'afk' || raw === 'offline') return raw;
    return 'offline';
  }

  private async writeState(userId: number, state: PresenceState): Promise<void> {
    await this.redis.set(RedisKey.presenceState(userId), state, 'EX', this.STATE_TTL_SECONDS);
  }

  /**
   * `presence:sessions:123` → 123. Returns null for malformed keys so a
   * stray key under the pattern doesn't crash the scheduler tick.
   */
  private userIdFromHashKey(hashKey: string): number | null {
    const prefix = 'presence:sessions:';
    if (!hashKey.startsWith(prefix)) return null;
    const id = Number(hashKey.slice(prefix.length));
    return Number.isInteger(id) && id > 0 ? id : null;
  }
}
