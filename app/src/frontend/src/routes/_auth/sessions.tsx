import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useState } from 'react';
import {
  listSessions,
  revokeSession,
  revokeAllSessions,
  type SessionsResponse,
  type SessionSummary,
} from '@/lib/sessions';
import { logout } from '@/lib/auth';
import { useSession } from '@/hooks/useSession';
import { disconnect as disconnectSocket } from '@/lib/socket';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { GlassCard, Chip } from '@/components/ui/surface';

export const Route = createFileRoute('/_auth/sessions')({
  component: SessionsRoute,
});

interface WireError {
  code: string;
  message: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; data: SessionsResponse }
  | { status: 'error'; error: WireError };

const formatTimestamp = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
};

const truncate = (s: string, n = 80): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Active sessions management — M4 / T26.
 *
 * Lists every refresh-token session bound to the current account, lets
 * the user revoke any individual session. Optimistic remove on click;
 * on failure the row is restored and a banner surfaces the WireError.
 *
 * Selectors are part of the e2e contract (see
 * `e2e-tests/e2e/m4-session-revoke.spec.ts`):
 *   - `[data-testid="session-row"]`
 *   - `[data-testid="session-revoke-btn"]`
 */
export function SessionsRoute() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Revoke-all uses its own submit flag so the header button doesn't
  // compete with the per-row buttons for one shared "mutating" latch.
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [revokeAllSubmitting, setRevokeAllSubmitting] = useState(false);
  const [revokeAllError, setRevokeAllError] = useState<string | null>(null);
  const navigate = useNavigate();
  const clearSession = useSession((s) => s.clearSession);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await listSessions();
      setState({ status: 'ok', data });
    } catch (err) {
      const error: WireError =
        err instanceof ApiError
          ? { code: err.code, message: err.message }
          : {
              code: 'UPSTREAM_UNAVAILABLE',
              message: err instanceof Error ? err.message : 'Failed to load sessions',
            };
      setState({ status: 'error', error });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = async (session: SessionSummary) => {
    if (pendingId) return;
    setSubmitError(null);
    setPendingId(session.id);

    // Optimistic remove — drop the row immediately, rollback on failure.
    const snapshot = state;
    if (state.status === 'ok') {
      setState({
        status: 'ok',
        data: { sessions: state.data.sessions.filter((s) => s.id !== session.id) },
      });
    }

    try {
      await revokeSession(session.id);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to revoke session',
      );
      // Rollback to the snapshot we captured before the optimistic strip.
      setState(snapshot);
    } finally {
      setPendingId(null);
    }
  };

  const handleRevokeAll = async (): Promise<void> => {
    if (revokeAllSubmitting) return;
    setRevokeAllError(null);
    setRevokeAllSubmitting(true);
    try {
      await revokeAllSessions();
      // Revoking includes the current session — the BFF cookie will 401
      // on the next probe. Run the same hard-logout sequence `_auth`
      // uses on click-logout so WS tears down, zustand session clears,
      // and the router sends us to /login without waiting for a 401.
      try {
        disconnectSocket();
      } catch {
        /* noop */
      }
      try {
        await logout();
      } catch {
        /* logout may 401 since cookies already revoked — ignore */
      }
      clearSession();
      navigate({ to: '/login', search: { allRevoked: 1 } as never });
    } catch (err) {
      setRevokeAllError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to revoke every session',
      );
    } finally {
      setRevokeAllSubmitting(false);
    }
  };

  return (
    <div className="animate-fade-up flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-display-sm font-extrabold text-on-surface">Sessions</h1>
          <p className="mt-2 font-body text-body-lg text-on-surface-variant">
            Every browser currently signed in to your account. Revoke any device you no longer
            recognise.
          </p>
        </div>
        <Button
          type="button"
          variant="danger"
          size="md"
          data-testid="sessions-revoke-all-btn"
          disabled={state.status !== 'ok' || state.data.sessions.length === 0}
          onClick={() => {
            setRevokeAllError(null);
            setRevokeAllOpen(true);
          }}
        >
          Revoke all sessions
        </Button>
      </header>

      {state.status === 'loading' && (
        <div data-testid="sessions-loading" aria-busy="true" className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-[1.5rem] bg-surface-container-low animate-pulse" />
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <GlassCard as="section" tone="error" radius="lg" padding="md" role="alert">
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
        </GlassCard>
      )}

      {state.status === 'ok' && (
        <GlassCard as="section" radius="lg" padding="md" aria-labelledby="sessions-heading">
          <h2
            id="sessions-heading"
            className="font-display text-title-md font-bold text-on-surface"
          >
            Active sessions ({state.data.sessions.length})
          </h2>

          {submitError && (
            <p
              role="alert"
              className="mt-3 font-body text-body-md text-on-error-container"
            >
              {submitError}
            </p>
          )}

          {state.data.sessions.length === 0 ? (
            <p className="mt-3 font-body text-body-md text-on-surface-variant">
              No active sessions. Sign in from another device to see it here.
            </p>
          ) : (
            <ul aria-label="Active sessions" className="mt-4 flex flex-col gap-3">
              {state.data.sessions.map((s) => (
                <li
                  key={s.id}
                  data-testid="session-row"
                  data-session-id={s.id}
                  data-current={s.current ? 'true' : 'false'}
                  className="flex flex-col gap-3 rounded-[1.5rem] bg-surface-container-low px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-title-sm font-semibold text-on-surface">
                        {s.userAgent ? truncate(s.userAgent) : 'Unknown device'}
                      </span>
                      {s.current && <Chip tone="primary">This device</Chip>}
                    </div>
                    <p className="font-body text-body-sm text-on-surface-variant">
                      {s.ip ?? 'unknown ip'}
                    </p>
                    <p className="font-body text-body-sm text-on-surface-variant">
                      Last seen {formatTimestamp(s.lastSeenAt)} · signed in{' '}
                      {formatTimestamp(s.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="session-revoke-btn"
                      disabled={pendingId !== null}
                      onClick={() => void handleRevoke(s)}
                    >
                      {s.current ? 'Sign out this device' : 'Revoke'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      )}

      {/*
        Revoke-all confirm dialog — portal'd to `document.body` for the same
        reason as the delete-message dialog in `rooms/$roomId.tsx`: the outer
        wrapper's `animate-fade-up` keyframe applies a `transform` which
        creates a containing block for `position:fixed`, so an inline modal
        would pin to the column, not the viewport.
      */}
      {revokeAllOpen
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="revoke-all-title"
              data-testid="revoke-all-dialog"
              className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/40 backdrop-blur-sm"
              onClick={(e) => {
                if (e.target === e.currentTarget && !revokeAllSubmitting) setRevokeAllOpen(false);
              }}
            >
              <div className="mx-4 w-full max-w-md rounded-[1.5rem] bg-surface-container px-6 py-5 shadow-ambient">
                <h2
                  id="revoke-all-title"
                  className="font-display text-title-md font-semibold text-on-surface"
                >
                  Revoke every session?
                </h2>
                <p className="mt-2 font-body text-body-md text-on-surface-variant">
                  This signs you out of every device, including this one. Use it if you think
                  someone else had access to your account.
                </p>
                {revokeAllError && (
                  <p className="mt-3 font-body text-body-sm text-error" role="alert">
                    {revokeAllError}
                  </p>
                )}
                <div className="mt-5 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setRevokeAllOpen(false)}
                    disabled={revokeAllSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    data-testid="sessions-revoke-all-confirm"
                    disabled={revokeAllSubmitting}
                    onClick={() => {
                      void handleRevokeAll();
                    }}
                  >
                    {revokeAllSubmitting ? 'Signing out…' : 'Revoke everywhere'}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
