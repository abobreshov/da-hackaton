import { Inject, Injectable } from '@nestjs/common';
import {
  RecordLoginInput,
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
}
