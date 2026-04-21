import { Inject, Injectable } from '@nestjs/common';
import {
  RecordLoginInput,
  RevokeAllInput,
  RevokeInput,
  SESSIONS_REPOSITORY,
  SessionRow,
  SessionsRepositoryPort,
} from './sessions.types';

/**
 * EPIC-02 §2.2.4 active-sessions domain service. Thin wrapper over the
 * repository port — domain rules are limited to:
 *   - revoke is scoped to the owning user (cross-user revokes are no-ops).
 *   - listActive excludes revoked sessions; ordering is the repo's job.
 *
 * `recordLogin` is best-effort from the auth-service caller's perspective:
 * the caller catches transport errors so login never fails on a tracker
 * hiccup. The service layer itself does not swallow errors — callers decide.
 */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(SESSIONS_REPOSITORY)
    private readonly repo: SessionsRepositoryPort,
  ) {}

  recordLogin(input: RecordLoginInput): Promise<SessionRow> {
    return this.repo.insertOnLogin(input);
  }

  listActive(userId: number): Promise<SessionRow[]> {
    return this.repo.listForUser(userId);
  }

  revoke(input: RevokeInput): Promise<{ revoked: boolean }> {
    return this.repo.revoke(input);
  }

  /**
   * Bulk revoke for the "Log out everywhere else" button. Forwards to the
   * repo; caller decides whether to preserve its current session via
   * `exceptSessionId`. Used by the FE sessions page AND (without an
   * exception) by auth-service on account-delete / password-change.
   */
  revokeAll(input: RevokeAllInput): Promise<{ revokedCount: number }> {
    return this.repo.revokeAll(input);
  }

  /**
   * Probe used by auth-service `validateToken` to short-circuit a JWT-valid
   * cookie whose underlying session row has been revoked. Fail-closed:
   * unknown ids resolve to `true` so a forged or stale `sid` claim never
   * extends authentication past the revoke moment.
   */
  isRevoked(sessionId: string): Promise<boolean> {
    return this.repo.isRevoked(sessionId);
  }

  /**
   * Bump `last_seen_at` heartbeat. Called from auth-service `validateToken`
   * on every successful (non-revoked) probe so the active-sessions UI
   * surfaces a real "last seen" instead of the row's creation time. Returns
   * `{ touched: false }` on missing / already-revoked rows.
   */
  touch(sessionId: string): Promise<{ touched: boolean }> {
    return this.repo.touch(sessionId);
  }
}
