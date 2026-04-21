/**
 * Unit tests for SessionsService (EPIC-02 §2.2.4). Fake repo exercises the
 * three domain methods without hitting Postgres.
 */

import { SessionsService } from './sessions.service';
import {
  RecordLoginInput,
  RevokeInput,
  SessionRow,
  SessionsRepositoryPort,
} from './sessions.types';

class FakeSessionsRepository implements SessionsRepositoryPort {
  rows: SessionRow[] = [];
  insertCalls: RecordLoginInput[] = [];
  revokeCalls: RevokeInput[] = [];
  /** When set, insertOnLogin will throw to simulate transport failure. */
  insertError: Error | null = null;

  async insertOnLogin(input: RecordLoginInput): Promise<SessionRow> {
    this.insertCalls.push(input);
    if (this.insertError) throw this.insertError;
    const row: SessionRow = {
      id: input.id ?? `uuid-${this.rows.length + 1}`,
      userId: input.userId,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
      createdAt: new Date('2026-04-20T10:00:00Z'),
      lastSeenAt: new Date('2026-04-20T10:00:00Z'),
      revokedAt: null,
    };
    this.rows.push(row);
    return row;
  }

  async listForUser(userId: number): Promise<SessionRow[]> {
    return this.rows
      .filter((r) => r.userId === userId && r.revokedAt == null)
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  }

  async revoke(input: RevokeInput): Promise<{ revoked: boolean }> {
    this.revokeCalls.push(input);
    const idx = this.rows.findIndex(
      (r) => r.id === input.id && r.userId === input.userId && r.revokedAt == null,
    );
    if (idx < 0) return { revoked: false };
    this.rows[idx] = { ...this.rows[idx], revokedAt: new Date() };
    return { revoked: true };
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    const row = this.rows.find((r) => r.id === sessionId);
    if (!row) return true; // fail-closed
    return row.revokedAt != null;
  }

  touchCalls: string[] = [];
  async touch(sessionId: string): Promise<{ touched: boolean }> {
    this.touchCalls.push(sessionId);
    const idx = this.rows.findIndex((r) => r.id === sessionId && r.revokedAt == null);
    if (idx < 0) return { touched: false };
    this.rows[idx] = { ...this.rows[idx], lastSeenAt: new Date() };
    return { touched: true };
  }
}

const USER = 42;

describe('SessionsService', () => {
  let repo: FakeSessionsRepository;
  let svc: SessionsService;

  beforeEach(() => {
    repo = new FakeSessionsRepository();
    svc = new SessionsService(repo);
  });

  describe('recordLogin', () => {
    it('inserts a session row and returns it', async () => {
      const out = await svc.recordLogin({
        userId: USER,
        userAgent: 'Mozilla/5.0',
        ip: '203.0.113.4',
      });
      expect(out.userId).toBe(USER);
      expect(out.userAgent).toBe('Mozilla/5.0');
      expect(out.ip).toBe('203.0.113.4');
      expect(out.revokedAt).toBeNull();
      expect(repo.insertCalls).toHaveLength(1);
    });

    it('forwards a caller-provided session id when present', async () => {
      const out = await svc.recordLogin({
        userId: USER,
        id: 'pre-minted-uuid',
      });
      expect(out.id).toBe('pre-minted-uuid');
      expect(repo.insertCalls[0].id).toBe('pre-minted-uuid');
    });

    it('persists with null UA/IP when those are not supplied', async () => {
      const out = await svc.recordLogin({ userId: USER });
      expect(out.userAgent).toBeNull();
      expect(out.ip).toBeNull();
    });
  });

  describe('listActive', () => {
    it('returns only non-revoked sessions for the requested user', async () => {
      await svc.recordLogin({ userId: USER, userAgent: 'A' });
      await svc.recordLogin({ userId: USER, userAgent: 'B' });
      await svc.recordLogin({ userId: 99, userAgent: 'other-user' });

      // Revoke the first one.
      const all = await repo.listForUser(USER);
      await svc.revoke({ id: all[0].id, userId: USER });

      const active = await svc.listActive(USER);
      expect(active).toHaveLength(1);
      expect(active[0].userId).toBe(USER);
      expect(active[0].revokedAt).toBeNull();
    });

    it('returns an empty array when the user has no sessions', async () => {
      await expect(svc.listActive(USER)).resolves.toEqual([]);
    });
  });

  describe('revoke', () => {
    it('marks a session revoked when it belongs to the caller', async () => {
      const row = await svc.recordLogin({ userId: USER });
      const out = await svc.revoke({ id: row.id, userId: USER });
      expect(out).toEqual({ revoked: true });

      const active = await svc.listActive(USER);
      expect(active).toHaveLength(0);
    });

    it('returns { revoked: false } when the session id does not exist', async () => {
      const out = await svc.revoke({ id: 'no-such-id', userId: USER });
      expect(out).toEqual({ revoked: false });
    });

    it('refuses cross-user revocation (returns { revoked: false })', async () => {
      const row = await svc.recordLogin({ userId: USER });
      const out = await svc.revoke({ id: row.id, userId: 99 });
      expect(out).toEqual({ revoked: false });
      // Still listed as active for the real owner.
      const active = await svc.listActive(USER);
      expect(active).toHaveLength(1);
    });

    it('is idempotent — second revoke of the same id returns { revoked: false }', async () => {
      const row = await svc.recordLogin({ userId: USER });
      await svc.revoke({ id: row.id, userId: USER });
      const out = await svc.revoke({ id: row.id, userId: USER });
      expect(out).toEqual({ revoked: false });
    });
  });

  describe('isRevoked', () => {
    it('returns false for an existing, non-revoked session', async () => {
      const row = await svc.recordLogin({ userId: USER });
      await expect(svc.isRevoked(row.id)).resolves.toBe(false);
    });

    it('returns true once the session is revoked', async () => {
      const row = await svc.recordLogin({ userId: USER });
      await svc.revoke({ id: row.id, userId: USER });
      await expect(svc.isRevoked(row.id)).resolves.toBe(true);
    });

    it('returns true (fail-closed) for an unknown session id', async () => {
      await expect(svc.isRevoked('no-such-uuid')).resolves.toBe(true);
    });
  });

  describe('touch', () => {
    it('bumps lastSeenAt on an active session and returns { touched: true }', async () => {
      const row = await svc.recordLogin({ userId: USER });
      const before = row.lastSeenAt.getTime();
      await new Promise((r) => setTimeout(r, 5));
      const out = await svc.touch(row.id);
      expect(out).toEqual({ touched: true });
      const [active] = await svc.listActive(USER);
      expect(active.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(repo.touchCalls).toEqual([row.id]);
    });

    it('returns { touched: false } for an unknown session id', async () => {
      await expect(svc.touch('no-such-uuid')).resolves.toEqual({ touched: false });
    });

    it('returns { touched: false } once the session is revoked', async () => {
      const row = await svc.recordLogin({ userId: USER });
      await svc.revoke({ id: row.id, userId: USER });
      await expect(svc.touch(row.id)).resolves.toEqual({ touched: false });
    });
  });
});
