import { apiFetch } from './api-client';

/**
 * Admin API client — EPIC-10 AC-10-12 / AC-10-14.
 *
 * All endpoints sit behind `SessionGuard + AdminGuard` at the BFF, so the
 * caller must already hold an admin session cookie for any call to succeed.
 *
 * The backend's `listOpen()` / `page()` return a flat `any[]` today; the wrapper
 * here shapes them into `{ reports, nextCursor }` / `{ entries, nextCursor }`
 * by deriving the cursor from the last row when the page is full. That keeps
 * the UI insulated from whether the BFF eventually learns to compute cursors
 * server-side.
 */

export type ReportStatus = 'open' | 'resolved' | 'dismissed';

export interface AdminReport {
  id: string;
  reporterId: number;
  reporterUsername?: string | null;
  targetType: 'message' | 'user';
  targetId: string;
  reason: string;
  status: ReportStatus;
  createdAt: string;
  resolvedById?: number | null;
  resolvedAt?: string | null;
  note?: string | null;
}

export interface ReportsCursor {
  beforeCreatedAt: string;
  beforeId: string;
}

export interface ListReportsInput {
  limit: number;
  beforeCreatedAt?: string;
  beforeId?: string;
}

export interface ListReportsResult {
  reports: AdminReport[];
  nextCursor: ReportsCursor | null;
}

export interface AuditEntry {
  id: string;
  actorId: number | null;
  actorType: 'user' | 'admin' | 'system';
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AuditCursor {
  beforeCreatedAt: string;
  beforeId: string;
}

export interface ListAuditLogInput {
  limit: number;
  actor?: number;
  action?: string;
  from?: string;
  to?: string;
  beforeCreatedAt?: string;
  beforeId?: string;
}

export interface ListAuditLogResult {
  entries: AuditEntry[];
  nextCursor: AuditCursor | null;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const q = usp.toString();
  return q ? `?${q}` : '';
}

/**
 * Fetch the admin queue of open abuse reports, newest first. Pass the
 * `nextCursor` from a previous call as `beforeCreatedAt` + `beforeId` to
 * page older rows.
 */
export async function listReports(input: ListReportsInput): Promise<ListReportsResult> {
  const query = buildQuery({
    limit: input.limit,
    beforeCreatedAt: input.beforeCreatedAt,
    beforeId: input.beforeId,
  });
  const rows = await apiFetch<AdminReport[]>(`/api/v1/admin/reports${query}`);
  // Derive cursor from the tail row only when the server saturated the page
  // size — otherwise we'd loop forever on a short page.
  const last = rows.length === input.limit ? rows[rows.length - 1] : null;
  const nextCursor: ReportsCursor | null = last
    ? { beforeCreatedAt: last.createdAt, beforeId: String(last.id) }
    : null;
  return { reports: rows, nextCursor };
}

/** Mark an open report as `resolved`. 204 on success; throws `ApiError` otherwise. */
export function resolveReport(id: string, note?: string): Promise<void> {
  return apiFetch<void>(`/api/v1/admin/reports/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify(note ? { note } : {}),
  });
}

/** Mark an open report as `dismissed`. 204 on success; throws `ApiError` otherwise. */
export function dismissReport(id: string, note?: string): Promise<void> {
  return apiFetch<void>(`/api/v1/admin/reports/${id}/dismiss`, {
    method: 'POST',
    body: JSON.stringify(note ? { note } : {}),
  });
}

/**
 * Paginate the admin audit log. Filters are optional; omit to pull the
 * global feed. `actor` takes a user/admin id, `action` is a keyword like
 * `report.resolve`.
 */
export async function listAuditLog(input: ListAuditLogInput): Promise<ListAuditLogResult> {
  const query = buildQuery({
    limit: input.limit,
    actor: input.actor,
    action: input.action,
    from: input.from,
    to: input.to,
    beforeCreatedAt: input.beforeCreatedAt,
    beforeId: input.beforeId,
  });
  const rows = await apiFetch<AuditEntry[]>(`/api/v1/admin/audit-log${query}`);
  const last = rows.length === input.limit ? rows[rows.length - 1] : null;
  const nextCursor: AuditCursor | null = last
    ? { beforeCreatedAt: last.createdAt, beforeId: String(last.id) }
    : null;
  return { entries: rows, nextCursor };
}
