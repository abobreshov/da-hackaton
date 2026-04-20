/**
 * Unit tests for AbuseReportsService (EPIC-06).
 *
 * The service depends on `AbuseReportsRepositoryPort` + `IEventPublisher`.
 * Spec drives a fully in-memory fake repository so the business rules
 * (reason length, target validation, partial-UNIQUE → CONFLICT, admin
 * gate, keyset paginator, status transitions) are exercised without
 * Postgres. The publisher is a `jest.fn()` — assertions confirm the
 * service emits the right domain event with the right payload (audit
 * append is the AuditSubscriber's concern, not the service's).
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AbuseReportsService } from './abuse-reports.service';
import type {
  AbuseReportRow,
  AbuseReportsRepositoryPort,
  InsertAbuseReportInput,
  ListOpenRepoInput,
  ReportStatus,
  UserRoleRow,
} from './abuse-reports.types';
import type { IEventPublisher } from '../../common/events/event-publisher.interface';

class FakeAbuseReportsRepository implements AbuseReportsRepositoryPort {
  byId = new Map<bigint, AbuseReportRow>();
  users = new Map<number, UserRoleRow>();
  private nextId = 1n;
  /** When set, the next insert call rejects with this error. */
  insertError: any = null;

  static openKey(reporterId: number, targetType: string, targetId: bigint): string {
    return `${reporterId}:${targetType}:${targetId.toString()}`;
  }

  private openIndex(): Map<string, AbuseReportRow> {
    const map = new Map<string, AbuseReportRow>();
    for (const r of this.byId.values()) {
      if (r.status === 'open') {
        map.set(FakeAbuseReportsRepository.openKey(r.reporterId, r.targetType, r.targetId), r);
      }
    }
    return map;
  }

  async insert(input: InsertAbuseReportInput): Promise<AbuseReportRow> {
    if (this.insertError) {
      const e = this.insertError;
      this.insertError = null;
      throw e;
    }
    const idx = this.openIndex();
    if (idx.has(FakeAbuseReportsRepository.openKey(input.reporterId, input.targetType, input.targetId))) {
      const err: any = new Error('duplicate key value violates unique constraint "abuse_reports_open_dedup_idx"');
      err.code = '23505';
      throw err;
    }
    const row: AbuseReportRow = {
      id: this.nextId++,
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      status: 'open',
      resolvedBy: null,
      resolvedAt: null,
      createdAt: new Date(),
    };
    this.byId.set(row.id, row);
    return row;
  }

  async findUserById(id: number): Promise<UserRoleRow | null> {
    return this.users.get(id) ?? null;
  }

  async listOpen(input: ListOpenRepoInput): Promise<AbuseReportRow[]> {
    let rows = [...this.byId.values()].filter((r) => r.status === 'open');
    if (input.before) {
      rows = rows.filter(
        (r) =>
          r.createdAt! < input.before!.createdAt ||
          (r.createdAt!.getTime() === input.before!.createdAt.getTime() && r.id < input.before!.id),
      );
    }
    rows.sort((a, b) => {
      const t = b.createdAt!.getTime() - a.createdAt!.getTime();
      if (t !== 0) return t;
      return Number(b.id - a.id);
    });
    return rows.slice(0, input.limit);
  }

  async findById(id: bigint): Promise<AbuseReportRow | null> {
    return this.byId.get(id) ?? null;
  }

  async updateStatus(
    id: bigint,
    status: Exclude<ReportStatus, 'open'>,
    resolvedBy: number,
    resolvedAt: Date,
  ): Promise<void> {
    const row = this.byId.get(id);
    if (!row) return;
    row.status = status;
    row.resolvedBy = resolvedBy;
    row.resolvedAt = resolvedAt;
  }
}

function seed(): FakeAbuseReportsRepository {
  const repo = new FakeAbuseReportsRepository();
  repo.users.set(1, { id: 1, role: 'ADMIN' });
  repo.users.set(2, { id: 2, role: 'USER' });
  repo.users.set(3, { id: 3, role: 'USER' });
  return repo;
}

function makeEvents(): jest.Mocked<IEventPublisher> {
  return { emit: jest.fn(), on: jest.fn() } as unknown as jest.Mocked<IEventPublisher>;
}

describe('AbuseReportsService', () => {
  describe('create()', () => {
    it('inserts a report with status=open + emits report.create', async () => {
      const repo = seed();
      const events = makeEvents();
      const svc = new AbuseReportsService(repo, events);

      const row = await svc.create({
        reporterId: 2,
        targetType: 'message',
        targetId: 100n,
        reason: 'spam',
      });

      expect(row.status).toBe('open');
      expect(row.reporterId).toBe(2);
      expect(repo.byId.size).toBe(1);
      expect(events.emit).toHaveBeenCalledWith('report.create', {
        actorId: 2,
        reportId: row.id,
        targetType: 'message',
        targetId: 100n,
      });
    });

    it('rejects a duplicate in-flight report (partial UNIQUE -> CONFLICT)', async () => {
      const repo = seed();
      const svc = new AbuseReportsService(repo, makeEvents());

      await svc.create({ reporterId: 2, targetType: 'user', targetId: 3n, reason: 'abuse' });

      await expect(
        svc.create({ reporterId: 2, targetType: 'user', targetId: 3n, reason: 'still abusing' }),
      ).rejects.toThrow(ConflictException);
    });

    it('permits a re-report once the previous was resolved/dismissed', async () => {
      const repo = seed();
      const svc = new AbuseReportsService(repo, makeEvents());

      const first = await svc.create({ reporterId: 2, targetType: 'user', targetId: 3n, reason: 'r1' });
      const row = repo.byId.get(first.id)!;
      row.status = 'resolved';

      await expect(
        svc.create({ reporterId: 2, targetType: 'user', targetId: 3n, reason: 'r2' }),
      ).resolves.toBeDefined();
    });

    it('rejects reason > 500 chars -> VALIDATION_FAILED', async () => {
      const repo = seed();
      const svc = new AbuseReportsService(repo, makeEvents());

      const longReason = 'x'.repeat(501);
      await expect(
        svc.create({ reporterId: 2, targetType: 'user', targetId: 3n, reason: longReason }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects empty reason', async () => {
      const repo = seed();
      const svc = new AbuseReportsService(repo, makeEvents());

      await expect(
        svc.create({ reporterId: 2, targetType: 'user', targetId: 3n, reason: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid targetType', async () => {
      const repo = seed();
      const svc = new AbuseReportsService(repo, makeEvents());

      await expect(
        svc.create({
          reporterId: 2,
          targetType: 'badger' as any,
          targetId: 3n,
          reason: 'nope',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not emit report.create on validation failure', async () => {
      const repo = seed();
      const events = makeEvents();
      const svc = new AbuseReportsService(repo, events);

      await expect(
        svc.create({ reporterId: 2, targetType: 'user', targetId: 3n, reason: '' }),
      ).rejects.toThrow(BadRequestException);
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('create() — error propagation', () => {
    it('re-throws non-23505 DB errors', async () => {
      const repo = seed();
      repo.insertError = Object.assign(new Error('pg busy'), { code: '08006' });
      const events = makeEvents();
      const svc = new AbuseReportsService(repo, events);

      await expect(
        svc.create({ reporterId: 2, targetType: 'message', targetId: 1n, reason: 'r' }),
      ).rejects.toThrow('pg busy');
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('listOpen()', () => {
    it('admin sees all open reports, keyset-paginated DESC by (createdAt, id)', async () => {
      const repo = seed();
      for (let i = 0; i < 3; i++) {
        const id = BigInt(i + 1);
        repo.byId.set(id, {
          id,
          reporterId: 2,
          targetType: 'user',
          targetId: BigInt(100 + i),
          reason: `r${i}`,
          status: 'open',
          resolvedBy: null,
          resolvedAt: null,
          createdAt: new Date(2026, 3, 20, 10, i),
        });
      }
      const svc = new AbuseReportsService(repo, makeEvents());

      const rows = await svc.listOpen({ adminId: 1, limit: 10 });
      expect(rows.length).toBe(3);
      expect(rows[0].id).toBeGreaterThan(rows[1].id);
    });

    it('non-admin cannot list', async () => {
      const repo = seed();
      const svc = new AbuseReportsService(repo, makeEvents());

      await expect(svc.listOpen({ adminId: 2, limit: 10 })).rejects.toThrow(ForbiddenException);
    });

    it('caps limit at 200', async () => {
      const repo = seed();
      const listSpy = jest.spyOn(repo, 'listOpen');
      const svc = new AbuseReportsService(repo, makeEvents());

      await svc.listOpen({ adminId: 1, limit: 10_000 });
      expect(listSpy).toHaveBeenCalledWith({ limit: 200, before: undefined });
    });

    it('floor-caps limit at 1 when caller supplies zero or negative', async () => {
      const repo = seed();
      const listSpy = jest.spyOn(repo, 'listOpen');
      const svc = new AbuseReportsService(repo, makeEvents());

      await svc.listOpen({ adminId: 1, limit: 0 });
      expect(listSpy).toHaveBeenCalledWith({ limit: 1, before: undefined });
    });

    it('forwards the keyset cursor when `before` is supplied', async () => {
      const repo = seed();
      const listSpy = jest.spyOn(repo, 'listOpen');
      const svc = new AbuseReportsService(repo, makeEvents());

      const before = { createdAt: new Date(2026, 3, 20, 10, 3), id: 999n };
      await svc.listOpen({ adminId: 1, limit: 10, before });
      expect(listSpy).toHaveBeenCalledWith({ limit: 10, before });
    });
  });

  describe('resolve()', () => {
    it('admin sets status=resolved + emits report.resolve', async () => {
      const repo = seed();
      const id = 42n;
      repo.byId.set(id, {
        id, reporterId: 2, targetType: 'user', targetId: 3n,
        reason: 'x', status: 'open', resolvedBy: null, resolvedAt: null,
        createdAt: new Date(),
      });
      const events = makeEvents();
      const svc = new AbuseReportsService(repo, events);

      await svc.resolve({ id, adminId: 1, note: 'handled offline' });

      expect(repo.byId.get(id)!.status).toBe('resolved');
      expect(repo.byId.get(id)!.resolvedBy).toBe(1);
      expect(events.emit).toHaveBeenCalledWith('report.resolve', {
        actorId: 1,
        reportId: id,
        note: 'handled offline',
      });
    });

    it('non-admin cannot resolve', async () => {
      const repo = seed();
      const id = 7n;
      repo.byId.set(id, {
        id, reporterId: 2, targetType: 'user', targetId: 3n,
        reason: 'x', status: 'open', resolvedBy: null, resolvedAt: null,
        createdAt: new Date(),
      });
      const svc = new AbuseReportsService(repo, makeEvents());

      await expect(svc.resolve({ id, adminId: 2 })).rejects.toThrow(ForbiddenException);
    });

    it('404 when report does not exist', async () => {
      const repo = seed();
      const svc = new AbuseReportsService(repo, makeEvents());

      await expect(svc.resolve({ id: 9999n, adminId: 1 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('dismiss()', () => {
    it('admin sets status=dismissed + emits report.dismiss', async () => {
      const repo = seed();
      const id = 8n;
      repo.byId.set(id, {
        id, reporterId: 2, targetType: 'user', targetId: 3n,
        reason: 'x', status: 'open', resolvedBy: null, resolvedAt: null,
        createdAt: new Date(),
      });
      const events = makeEvents();
      const svc = new AbuseReportsService(repo, events);

      await svc.dismiss({ id, adminId: 1 });

      expect(repo.byId.get(id)!.status).toBe('dismissed');
      expect(events.emit).toHaveBeenCalledWith('report.dismiss', {
        actorId: 1,
        reportId: id,
        note: undefined,
      });
    });

    it('non-admin cannot dismiss', async () => {
      const repo = seed();
      const id = 9n;
      repo.byId.set(id, {
        id, reporterId: 2, targetType: 'user', targetId: 3n,
        reason: 'x', status: 'open', resolvedBy: null, resolvedAt: null,
        createdAt: new Date(),
      });
      const svc = new AbuseReportsService(repo, makeEvents());

      await expect(svc.dismiss({ id, adminId: 2 })).rejects.toThrow(ForbiddenException);
    });
  });
});
