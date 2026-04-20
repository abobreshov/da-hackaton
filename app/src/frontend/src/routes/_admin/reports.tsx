import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import {
  listReports,
  resolveReport,
  dismissReport,
  type AdminReport,
  type ReportsCursor,
} from '@/lib/admin';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/surface';
import { EmptyState } from '@/components/empty-state';

export const Route = createFileRoute('/_admin/reports')({
  component: AdminReportsRoute,
});

const PAGE_SIZE = 25;
const REASON_PREVIEW_CHARS = 160;

interface WireError {
  code: string;
  message: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; reports: AdminReport[]; nextCursor: ReportsCursor | null }
  | { status: 'error'; error: WireError };

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max).trimEnd()}…`;
}

function StatusBadge({ status }: { status: AdminReport['status'] }) {
  const tone =
    status === 'open'
      ? 'bg-error-container text-on-error-container'
      : status === 'resolved'
        ? 'bg-tertiary-container text-on-tertiary-container'
        : 'bg-surface-container-high text-on-surface-variant';
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 font-display text-label-md uppercase tracking-[0.14em] ${tone}`}
    >
      {status}
    </span>
  );
}

/**
 * Admin abuse-report queue (EPIC-10 AC-10-12).
 *
 * Displays the currently-open reports newest first. Each row carries the
 * reporter, target, reason preview, and status, plus Resolve / Dismiss
 * actions that POST to the BFF and refresh the list in place. Older pages
 * are appended via cursor pagination — we never drop earlier pages on
 * "Load older" so admins can scroll back through a single triage session.
 */
export function AdminReportsRoute() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const { reports, nextCursor } = await listReports({ limit: PAGE_SIZE });
      setState({ status: 'ok', reports, nextCursor });
    } catch (err) {
      const error: WireError =
        err instanceof ApiError
          ? { code: err.code, message: err.message }
          : {
              code: 'UPSTREAM_UNAVAILABLE',
              message: err instanceof Error ? err.message : 'Failed to load reports',
            };
      setState({ status: 'error', error });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (state.status !== 'ok' || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { reports, nextCursor } = await listReports({
        limit: PAGE_SIZE,
        beforeCreatedAt: state.nextCursor.beforeCreatedAt,
        beforeId: state.nextCursor.beforeId,
      });
      setState({
        status: 'ok',
        reports: [...state.reports, ...reports],
        nextCursor,
      });
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to load older reports',
      );
    } finally {
      setLoadingMore(false);
    }
  };

  const runAction = async (
    report: AdminReport,
    op: 'resolve' | 'dismiss',
  ) => {
    if (actioning) return;
    setActionError(null);
    setActioning(report.id);
    try {
      if (op === 'resolve') await resolveReport(report.id);
      else await dismissReport(report.id);
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Action failed',
      );
    } finally {
      setActioning(null);
    }
  };

  return (
    <div className="animate-fade-up flex flex-col gap-8">
      <header>
        <h1 className="font-display text-display-sm font-extrabold text-on-surface">
          Abuse reports
        </h1>
        <p className="mt-2 font-body text-body-lg text-on-surface-variant">
          Triage open reports. Resolving or dismissing closes the ticket and
          writes an audit-log entry.
        </p>
      </header>

      {actionError && (
        <div
          role="alert"
          className="rounded-[1.5rem] bg-error-container/70 px-6 py-4 font-body text-body-md text-on-error-container shadow-ambient"
        >
          {actionError}
        </div>
      )}

      {state.status === 'loading' && (
        <div data-testid="reports-loading" aria-busy="true" className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 rounded-[1.5rem] bg-surface-container-low animate-pulse"
            />
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <section
          className="rounded-[2rem] bg-error-container/70 p-6 shadow-ambient"
          role="alert"
        >
          <p className="font-display text-label-lg font-semibold uppercase tracking-[0.18em] text-on-error-container/80">
            {state.error.code}
          </p>
          <p className="mt-2 font-body text-body-lg text-on-error-container">
            {state.error.message}
          </p>
          <div className="mt-4">
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        </section>
      )}

      {state.status === 'ok' && state.reports.length === 0 && (
        <EmptyState
          title="No open reports"
          description="Nothing to triage right now — new reports from users will appear here."
        />
      )}

      {state.status === 'ok' && state.reports.length > 0 && (
        <>
          <ul aria-label="Open reports" className="flex flex-col gap-4">
            {state.reports.map((r) => {
              const reporter =
                r.reporterUsername ?? `user #${r.reporterId}`;
              const isActing = actioning === r.id;
              return (
                <li key={r.id}>
                  <GlassCard radius="lg" padding="lg" shadow="ambient">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-display text-title-sm font-bold text-on-surface">
                            {reporter}
                          </span>
                          <span className="font-body text-body-sm text-on-surface-variant">
                            reported
                          </span>
                          <span className="font-body text-body-sm text-on-surface">
                            {r.targetType} #{r.targetId}
                          </span>
                          <StatusBadge status={r.status} />
                        </div>
                        <p
                          data-testid={`report-reason-${r.id}`}
                          className="mt-3 font-body text-body-md text-on-surface-variant"
                        >
                          {truncate(r.reason, REASON_PREVIEW_CHARS)}
                        </p>
                        <p className="mt-2 font-body text-body-sm text-on-surface-variant/70">
                          {new Date(r.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          size="sm"
                          disabled={isActing || r.status !== 'open'}
                          onClick={() => void runAction(r, 'resolve')}
                        >
                          Resolve
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isActing || r.status !== 'open'}
                          onClick={() => void runAction(r, 'dismiss')}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  </GlassCard>
                </li>
              );
            })}
          </ul>

          {state.nextCursor && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? 'Loading…' : 'Load older'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
