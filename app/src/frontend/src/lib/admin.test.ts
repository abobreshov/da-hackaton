import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listReports, resolveReport, dismissReport, listAuditLog } from './admin';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('lib/admin', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'csrf=tok',
      set: () => {},
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('listReports()', () => {
    it('GETs /api/v1/admin/reports with limit query', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([]));
      const res = await listReports({ limit: 50 });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/api\/v1\/admin\/reports\?limit=50$/);
      expect((init as RequestInit).method).toBe('GET');
      expect((init as RequestInit).credentials).toBe('include');
      expect(res).toEqual({ reports: [], nextCursor: null });
    });

    it('passes beforeCreatedAt + beforeId on the query string', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([]));
      await listReports({
        limit: 25,
        beforeCreatedAt: '2026-04-20T10:00:00.000Z',
        beforeId: '999',
      });
      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('limit=25');
      expect(url).toContain('beforeCreatedAt=2026-04-20T10%3A00%3A00.000Z');
      expect(url).toContain('beforeId=999');
    });

    it('derives nextCursor from the tail row when page is saturated', async () => {
      const rows = [
        {
          id: '10',
          reporterId: 1,
          targetType: 'message',
          targetId: '100',
          reason: 'r1',
          status: 'open',
          createdAt: '2026-04-20T12:00:00.000Z',
        },
        {
          id: '9',
          reporterId: 2,
          targetType: 'user',
          targetId: '200',
          reason: 'r2',
          status: 'open',
          createdAt: '2026-04-20T11:00:00.000Z',
        },
      ];
      fetchMock.mockResolvedValueOnce(jsonResponse(rows));
      const res = await listReports({ limit: 2 });
      expect(res.reports).toHaveLength(2);
      expect(res.nextCursor).toEqual({
        beforeCreatedAt: '2026-04-20T11:00:00.000Z',
        beforeId: '9',
      });
    });

    it('returns nextCursor=null when the page is short (last page)', async () => {
      const rows = [
        {
          id: '10',
          reporterId: 1,
          targetType: 'message',
          targetId: '100',
          reason: 'r',
          status: 'open',
          createdAt: '2026-04-20T12:00:00.000Z',
        },
      ];
      fetchMock.mockResolvedValueOnce(jsonResponse(rows));
      const res = await listReports({ limit: 50 });
      expect(res.nextCursor).toBeNull();
    });
  });

  describe('resolveReport() / dismissReport()', () => {
    it('POSTs /api/v1/admin/reports/:id/resolve with { note }', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await resolveReport('42', 'looks good');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/api\/v1\/admin\/reports\/42\/resolve$/);
      expect((init as RequestInit).method).toBe('POST');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ note: 'looks good' });
    });

    it('resolveReport() without a note still POSTs an empty JSON body', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await resolveReport('42');
      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({});
    });

    it('POSTs /api/v1/admin/reports/:id/dismiss', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await dismissReport('77', 'spam');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/api\/v1\/admin\/reports\/77\/dismiss$/);
      expect((init as RequestInit).method).toBe('POST');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ note: 'spam' });
    });

    it('surfaces ApiError on non-2xx resolve', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'gone' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(resolveReport('1')).rejects.toMatchObject({
        status: 404,
        code: 'NOT_FOUND',
        message: 'gone',
      });
    });
  });

  describe('listAuditLog()', () => {
    it('GETs /api/v1/admin/audit-log with filters + cursor', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([]));
      await listAuditLog({
        limit: 50,
        actor: 5,
        action: 'report.resolve',
        from: '2026-04-01',
        to: '2026-04-20',
        beforeCreatedAt: '2026-04-20T10:00:00.000Z',
        beforeId: '42',
      });
      const [url, init] = fetchMock.mock.calls[0];
      const s = String(url);
      expect(s).toMatch(/\/api\/v1\/admin\/audit-log\?/);
      expect(s).toContain('limit=50');
      expect(s).toContain('actor=5');
      expect(s).toContain('action=report.resolve');
      expect(s).toContain('from=2026-04-01');
      expect(s).toContain('to=2026-04-20');
      expect(s).toContain('beforeId=42');
      expect((init as RequestInit).method).toBe('GET');
    });

    it('omits undefined + empty-string filters from the query', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([]));
      await listAuditLog({ limit: 25, action: '' });
      const [url] = fetchMock.mock.calls[0];
      const s = String(url);
      expect(s).toContain('limit=25');
      expect(s).not.toContain('action=');
      expect(s).not.toContain('actor=');
    });

    it('derives nextCursor from tail row on a saturated page', async () => {
      const rows = [
        {
          id: '100',
          actorId: 1,
          actorType: 'admin',
          action: 'report.resolve',
          targetType: 'abuse_report',
          targetId: '9',
          metadata: null,
          createdAt: '2026-04-20T12:00:00.000Z',
        },
        {
          id: '99',
          actorId: 2,
          actorType: 'admin',
          action: 'report.dismiss',
          targetType: 'abuse_report',
          targetId: '8',
          metadata: null,
          createdAt: '2026-04-20T11:00:00.000Z',
        },
      ];
      fetchMock.mockResolvedValueOnce(jsonResponse(rows));
      const res = await listAuditLog({ limit: 2 });
      expect(res.entries).toHaveLength(2);
      expect(res.nextCursor).toEqual({
        beforeCreatedAt: '2026-04-20T11:00:00.000Z',
        beforeId: '99',
      });
    });

    it('nextCursor=null when page is short', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([]));
      const res = await listAuditLog({ limit: 50 });
      expect(res.nextCursor).toBeNull();
      expect(res.entries).toEqual([]);
    });
  });
});
