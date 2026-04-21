import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, createHash, randomUUID } from 'crypto';
import { CacheService } from '../../../cache/cache.service';
import { env } from '../../../config/environment';

interface RefreshTokenData {
  id: number;
  familyId: string;
  sessionStartedAt: number;
  /**
   * Optional `user_sessions.id` (UUID) bound to this refresh family. When
   * present, `validateAndRotate` returns it alongside the rotated token so
   * the caller can re-stamp the same `sid` claim into the new access token —
   * preserving the active-sessions revoke link across rotations (M5 review
   * fix). Absent on tokens minted before this field shipped (back-compat).
   */
  sid?: string;
}

/**
 * Refresh-token store with OAuth 2.1 §6.1 reuse detection.
 *
 * Key layout (per user, `type` ∈ {'a' admin, 'u' customer}):
 *
 *   refresh:{type}:{id}:{hash}                         live token  (TTL = TTL)
 *   refresh:{type}:{id}:tokens                         legacy flat tracking set
 *                                                      of every live refresh key
 *                                                      (kept so revokeAll() and
 *                                                      earlier behaviour stay
 *                                                      backwards-compatible)
 *   refresh:{type}:{id}:hist:{hash}                    familyId of a token that
 *                                                      EXISTED. Written on
 *                                                      create() and kept for
 *                                                      SESSION_MAX TTL so that
 *                                                      re-presenting a rotated
 *                                                      hash identifies the
 *                                                      family to revoke.
 *   refresh:{type}:{id}:fam:{familyId}:members         set of live token hashes
 *                                                      in the family (used to
 *                                                      delete sibling tokens
 *                                                      on reuse detection)
 *   refresh:{type}:{id}:fam:{familyId}:revoked         marker; presence => every
 *                                                      token in the family is
 *                                                      dead, even ones still
 *                                                      inside `tokens`
 *
 * Reuse semantics (`validateAndRotate`):
 *   1. Presented token's live key missing AND history entry present  →  REUSE.
 *      Revoke the entire family (delete all member keys + flip the revoked
 *      flag) and reject. This covers the attacker-replays-stolen-token path.
 *   2. Presented token's live key present but family is flagged revoked  →
 *      reject. Covers the window where fix-1 already ran.
 *   3. Happy path: delete live key, write new live key + history entry,
 *      inherit familyId, update member set.
 *
 * History entries use the SESSION_MAX_DURATION_DAYS TTL so a replay arriving
 * after the attacker waits out a normal 24h refresh TTL still gets caught as
 * long as the original session window is intact.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);
  private readonly TTL = 24 * 60 * 60; // 24h refresh TTL
  private get historyTtl(): number {
    // Keep the "this hash belonged to familyId X" pointer alive for as long as
    // a session can exist — that's the upper bound on attacker replay.
    return env.SESSION_MAX_DURATION_DAYS * 24 * 60 * 60;
  }

  constructor(private readonly cache: CacheService) {}

  private makeToken(type: 'a' | 'u', id: number): string {
    return `${type}:${id}:${randomBytes(32).toString('hex')}`;
  }

  private hashOf(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private tokenKey(type: 'a' | 'u', id: number, hash: string): string {
    return `refresh:${type}:${id}:${hash}`;
  }

  private trackingKey(type: 'a' | 'u', id: number): string {
    return `refresh:${type}:${id}:tokens`;
  }

  private historyKey(type: 'a' | 'u', id: number, hash: string): string {
    return `refresh:${type}:${id}:hist:${hash}`;
  }

  private familyMembersKey(type: 'a' | 'u', id: number, familyId: string): string {
    return `refresh:${type}:${id}:fam:${familyId}:members`;
  }

  private familyRevokedKey(type: 'a' | 'u', id: number, familyId: string): string {
    return `refresh:${type}:${id}:fam:${familyId}:revoked`;
  }

  /**
   * Seed a new token family. Called on login / register. `opts.sid` binds an
   * `user_sessions.id` to the family so subsequent `validateAndRotate` calls
   * can hand it back to the caller — needed so refresh-rotation keeps the
   * same `sid` claim on the access token (M5 review).
   */
  async create(type: 'a' | 'u', id: number, opts: { sid?: string } = {}): Promise<string> {
    const familyId = randomUUID();
    return this.issue(type, id, {
      id,
      familyId,
      sessionStartedAt: Date.now(),
      ...(opts.sid ? { sid: opts.sid } : {}),
    });
  }

  /**
   * Rotate a valid token (single-use), or detect reuse and revoke the family.
   * Returns both the new opaque token and the `sid` that the consumed family
   * was bound to (if any) so callers can re-stamp it onto the new access
   * token without losing the active-sessions revoke link.
   */
  async validateAndRotate(
    type: 'a' | 'u',
    id: number,
    token: string,
  ): Promise<{ token: string; sid?: string }> {
    const hash = this.hashOf(token);
    const liveKey = this.tokenKey(type, id, hash);
    const raw = await this.cache.get(liveKey);

    if (!raw) {
      // Live key missing. Three cases:
      //   a) Token never existed (random junk) → history miss → invalid.
      //   b) Token existed and was already rotated / revoked and its family
      //      is already marked revoked → family was killed previously → just
      //      invalid, don't re-trigger a reuse event.
      //   c) Token existed, was spent, and the family is still alive → REUSE.
      //      Revoke the entire family fast.
      const familyId = await this.cache.get(this.historyKey(type, id, hash));
      if (familyId) {
        const alreadyRevoked = await this.cache.exists(this.familyRevokedKey(type, id, familyId));
        if (!alreadyRevoked) {
          await this.revokeFamily(type, id, familyId);
          throw new Error('Refresh token reuse detected — session revoked');
        }
      }
      throw new Error('Invalid or expired refresh token');
    }

    const data: RefreshTokenData = JSON.parse(raw);

    // Guard: another reuse on a sibling token may have flipped the family flag.
    if (await this.cache.exists(this.familyRevokedKey(type, id, data.familyId))) {
      // Clean up the live artefact so it can't resurrect future checks.
      await this.cache.del(liveKey);
      await this.cache.srem(this.trackingKey(type, id), liveKey);
      throw new Error('Invalid or expired refresh token');
    }

    const maxMs = env.SESSION_MAX_DURATION_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - data.sessionStartedAt > maxMs) {
      await this.cache.del(liveKey);
      await this.cache.srem(this.trackingKey(type, id), liveKey);
      await this.cache.srem(this.familyMembersKey(type, id, data.familyId), hash);
      throw new Error('Session expired, please log in again');
    }

    // Rotate: delete the presented token, issue a new one inheriting familyId.
    await this.cache.del(liveKey);
    await this.cache.srem(this.trackingKey(type, id), liveKey);
    await this.cache.srem(this.familyMembersKey(type, id, data.familyId), hash);
    // History pointer of the just-rotated hash stays (it was written by
    // issue() on initial creation) — its presence is what catches future
    // replays of this hash.

    const newToken = await this.issue(type, id, { ...data, id });
    return { token: newToken, ...(data.sid ? { sid: data.sid } : {}) };
  }

  async revoke(type: 'a' | 'u', id: number, token: string): Promise<void> {
    const hash = this.hashOf(token);
    const key = this.tokenKey(type, id, hash);

    // Pull familyId first (if live) so we can keep the family-members set tidy.
    const raw = await this.cache.get(key);
    let familyId: string | null = null;
    if (raw) {
      try {
        familyId = (JSON.parse(raw) as RefreshTokenData).familyId ?? null;
      } catch {
        /* malformed — fall through */
      }
    }

    await this.cache.del(key);
    await this.cache.srem(this.trackingKey(type, id), key);
    if (familyId) {
      await this.cache.srem(this.familyMembersKey(type, id, familyId), hash);
    }
    // Drop the history pointer too — an explicit revoke (logout / password
    // change) is not a reuse event, so future presentation of the same token
    // should read as "invalid" rather than trigger a family-wide kill.
    await this.cache.del(this.historyKey(type, id, hash));
  }

  async revokeAll(type: 'a' | 'u', id: number): Promise<void> {
    const trackKey = this.trackingKey(type, id);
    const keys = await this.cache.smembers(trackKey);
    if (keys.length) await this.cache.del(...keys);
    await this.cache.del(trackKey);
    // Note: we deliberately leave family:*:revoked flags / history entries
    // alone here — revokeAll is idempotent regardless, and any straggling
    // flag just hardens re-replay defence until its TTL expires.
  }

  // ---- helpers -----------------------------------------------------------

  /**
   * Revoke every live token in a family and flip the revoked marker so any
   * future use of a sibling token fails fast (belt + suspenders alongside
   * the live-key deletions).
   */
  private async revokeFamily(type: 'a' | 'u', id: number, familyId: string): Promise<void> {
    const membersKey = this.familyMembersKey(type, id, familyId);
    const memberHashes = await this.cache.smembers(membersKey);
    const liveKeys = memberHashes.map((h) => this.tokenKey(type, id, h));

    if (liveKeys.length) {
      await this.cache.del(...liveKeys);
      // Clean out of legacy tracking set too so revokeAll()'s view stays sane.
      for (const k of liveKeys) await this.cache.srem(this.trackingKey(type, id), k);
    }
    await this.cache.del(membersKey);
    // Marker survives for the session-max window. Any straggling sibling that
    // somehow escaped the DEL above will still fail on the revoked-flag guard.
    await this.cache.set(this.familyRevokedKey(type, id, familyId), '1', this.historyTtl);

    this.logger.warn(
      `Refresh-token reuse detected — revoked family ${familyId} for ${type}:${id} (${liveKeys.length} live tokens killed)`,
    );
  }

  /**
   * Mint a token carrying the given family context, write all bookkeeping keys.
   */
  private async issue(type: 'a' | 'u', id: number, data: RefreshTokenData): Promise<string> {
    const token = this.makeToken(type, id);
    const hash = this.hashOf(token);
    const key = this.tokenKey(type, id, hash);

    await this.cache.set(key, JSON.stringify(data), this.TTL);
    await this.cache.sadd(this.trackingKey(type, id), key);
    await this.cache.sadd(this.familyMembersKey(type, id, data.familyId), hash);
    await this.cache.set(this.historyKey(type, id, hash), data.familyId, this.historyTtl);
    return token;
  }
}
