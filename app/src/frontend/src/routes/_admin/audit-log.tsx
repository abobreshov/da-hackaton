import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import {
  listAuditLog,
  type AuditEntry,
  type AuditCursor,
} from '@/lib/admin';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/surface';
import { EmptyState } from '@/components/empty-state';

export const Route = createFileRoute('/_admin/audit-log')({
  component: AdminAuditLogRoute,
});

const PAGE_SIZE = 50;

interface WireError {
  code: string;
  message: string;
}

interface Filters {
  actor: string;
  action: string;
  from: string;
  to: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; entries: AuditEntry[]; nextCursor: AuditCursor | null }
  | { status: 'error'; error: WireError };

const EMPTY_FILTERS: Filters = { actor: '', action: '', from: '', to: '' };

function metadataPreview(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    const s = JSON.stringify(value);
    if (!s) return '—';
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  } catch {
    return '[unserialisable]';
  }
}

/**
 * Admin audit log viewer (EPIC-10 AC-10-14).
 *
 * Filters are client-side state; hitting "Apply filters" triggers a fresh
 * server fetch with the current values. Cursor pagination is scoped to the
 * currently-applied filter set — changing a filter discards the old page
 * stack and refetches from the top to avoid mixing results across queries.
 */
export function AdminAuditLogRoute() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (f: Filters) => {
    setState({ status: 'loading' });
    try {
      const actorNum = f.actor ? Number(f.actor) : undefined;
      const { entries, nextCursor } = await listAuditLog({
        limit: PAGE_SIZE,
        actor: Number.isFinite(actorNum) ? actorNum : undefined,
        action: f.action || undefined,
        from: f.from || undefined,
        to: f.to || undefined,
      });
      setState({ status: 'ok', entries, nextCursor });
    } catch (err) {
      const error: WireError =
        err instanceof ApiError
          ? { code: err.code, message: err.message }
          : {
              code: 'UPSTREAM_UNAVAILABLE',
              message: err instanceof Error ? err.message : 'Failed to load audit log',
            };
      setState({ status: 'error', error });
    }
  }, []);

  useEffect(() => {
    void load(EMPTY_FILTERS);
  }, [load]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAppliedFilters(filters);
    void load(filters);
  };

  const handleReset = () => {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    void load(EMPTY_FILTERS);
  };

  const loadMore = async () => {
    if (state.status !== 'ok' || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const actorNum = appliedFilters.actor ? Number(appliedFilters.actor) : undefined;
      const { entries, nextCursor } = await listAuditLog({
        limit: PAGE_SIZE,
        actor: Number.isFinite(actorNum) ? actorNum : undefined,
        action: appliedFilters.action || undefined,
        from: appliedFilters.from || undefined,
        to: appliedFilters.to || undefined,
        beforeCreatedAt: state.nextCursor.beforeCreatedAt,
        beforeId: state.nextCursor.beforeId,
      });
      setState({
        status: 'ok',
        entries: [...state.entries, ...entries],
        nextCursor,
      });
    } catch {
      // surface via the main error bucket — refetch
      void load(appliedFilters);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="animate-fade-up flex flex-col gap-8">
      <header>
        <h1 className="font-display text-display-sm font-extrabold text-on-surface">
          Audit log
        </h1>
        <p className="mt-2 font-body text-body-lg text-on-surface-variant">
          Privileged actions, newest first. Use the filters to drill into a
          specific actor or action.
        </p>
      </header>

      <GlassCard as="section" radius="lg" padding="lg" shadow="ambient" aria-labelledby="audit-filters">
        <h2
          id="audit-filters"
          className="font-display text-title-md font-bold text-on-surface"
        >
          Filters
        </h2>
        <form
          onSubmit={handleSubmit}
          className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          aria-label="Audit log filters"
        >
          <div>
            <Label htmlFor="audit-actor">Actor</Label>
            <Input
              id="audit-actor"
              name="actor"
              type="number"
              inputMode="numeric"
              placeholder="user id"
              value={filters.actor}
              onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="audit-action">Action</Label>
            <Input
              id="audit-action"
              name="action"
              type="text"
              placeholder="e.g. report.resolve"
              value={filters.action}
              onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="audit-from">From</Label>
            <Input
              id="audit-from"
              name="from"
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="audit-to">To</Label>
            <Input
              id="audit-to"
              name="to"
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            />
          </div>
          <div className="flex gap-3 sm:col-span-2 lg:col-span-4">
            <Button type="submit" size="sm">
              Apply filters
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleReset}>
              Reset
            </Button>
          </div>
        </form>
      </GlassCard>

      {state.status === 'loading' && (
        <div data-testid="audit-loading" aria-busy="true" className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-12 rounded-[1rem] bg-surface-container-low animate-pulse"
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
            <Button variant="outline" size="sm" onClick={() => void load(appliedFilters)}>
              Retry
            </Button>
          </div>
        </section>
      )}

      {state.status === 'ok' && state.entries.length === 0 && (
        <EmptyState
          title="No audit entries"
          description="Nothing matches the current filters."
        />
      )}

      {state.status === 'ok' && state.entries.length > 0 && (
        <>
          <GlassCard as="section" radius="lg" padding="none" shadow="ambient" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full" aria-label="Audit log entries">
                <thead>
                  <tr className="bg-surface-container-low">
                    <th
                      scope="col"
                      className="px-4 py-3 text-left font-display text-label-lg font-semibold text-on-surface"
                    >
                      Timestamp
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left font-display text-label-lg font-semibold text-on-surface"
                    >
                      Actor
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left font-display text-label-lg font-semibold text-on-surface"
                    >
                      Action
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left font-display text-label-lg font-semibold text-on-surface"
                    >
                      Target
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left font-display text-label-lg font-semibold text-on-surface"
                    >
                      Metadata
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.entries.map((e) => (
                    <tr key={e.id} className="align-top">
                      <td className="px-4 py-3 font-body text-body-sm text-on-surface-variant">
                        {new Date(e.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-body text-body-sm text-on-surface">
                        {e.actorId !== null ? (
                          <span>
                            {e.actorType} #{e.actorId}
                          </span>
                        ) : (
                          <span className="text-on-surface-variant">system</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-body text-body-sm text-on-surface">
                        <code className="rounded bg-surface-container-low px-2 py-0.5 font-mono text-label-md">
                          {e.action}
                        </code>
                      </td>
                      <td className="px-4 py-3 font-body text-body-sm text-on-surface">
                        {e.targetType ? (
                          <span>
                            {e.targetType}
                            {e.targetId ? ` #${e.targetId}` : ''}
                          </span>
                        ) : (
                          <span className="text-on-surface-variant">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-body text-body-sm text-on-surface-variant">
                        <code
                          data-testid={`audit-meta-${e.id}`}
                          className="font-mono text-label-md"
                        >
                          {metadataPreview(e.metadata)}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>

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
