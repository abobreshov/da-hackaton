import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listFriends,
  sendFriendRequest,
  acceptRequest,
  rejectRequest,
  removeFriend,
  type FriendsResponse,
} from '@/lib/friends';
import { ApiError } from '@/lib/api-client';
import { usePresenceMap, type PresenceStatus } from '@/hooks/usePresenceMap';
import { useUnread } from '@/hooks/useUnread';
import { PresenceDot } from '@/components/presence-dot';
import { UnreadBadge } from '@/components/unread-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/surface';
import { UserPopover } from '@/components/user-popover';

export const Route = createFileRoute('/_auth/contacts')({
  component: ContactsRoute,
});

interface WireError {
  code: string;
  message: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; data: FriendsResponse }
  | { status: 'error'; error: WireError };

/**
 * Contacts (friends + pending requests) page.
 *
 * M2 scope — split into three panes:
 *   - Friends list with presence dots
 *   - Incoming requests with accept/reject buttons
 *   - Outgoing requests (read-only, cancel deferred)
 * Plus a "Add friend by username" form that POSTs and then refreshes.
 */
export function ContactsRoute() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [username, setUsername] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const presence = usePresenceMap();
  const { dms: dmUnread } = useUnread();

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await listFriends();
      setState({ status: 'ok', data });
    } catch (err) {
      const error: WireError =
        err instanceof ApiError
          ? { code: err.code, message: err.message }
          : {
              code: 'UPSTREAM_UNAVAILABLE',
              message: err instanceof Error ? err.message : 'Failed to load friends',
            };
      setState({ status: 'error', error });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const presenceFor = useMemo(
    () =>
      (userId: number): PresenceStatus =>
        presence.get(userId) ?? 'offline',
    [presence],
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const uname = username.trim();
    if (!uname || mutating) return;
    setSubmitError(null);
    setMutating(true);
    try {
      await sendFriendRequest(uname);
      setUsername('');
      await load();
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to send friend request',
      );
    } finally {
      setMutating(false);
    }
  };

  const runMutation = async (fn: () => Promise<void>) => {
    if (mutating) return;
    setMutating(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Action failed',
      );
    } finally {
      setMutating(false);
    }
  };

  return (
    <div className="animate-fade-up flex flex-col gap-8">
      <header>
        <h1 className="font-display text-display-sm font-extrabold text-on-surface">Contacts</h1>
        <p className="mt-2 font-body text-body-lg text-on-surface-variant">
          Your friends and pending invitations live here.
        </p>
      </header>

      {/* Add friend form */}
      <GlassCard as="section" radius="lg" padding="md" aria-labelledby="add-friend-heading">
        <h2
          id="add-friend-heading"
          className="font-display text-title-md font-bold text-on-surface"
        >
          Add a friend
        </h2>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="friend-username">Add friend by username</Label>
            <Input
              id="friend-username"
              name="username"
              autoComplete="off"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={mutating}
            />
          </div>
          <Button type="submit" disabled={mutating || username.trim().length === 0} size="md">
            Send request
          </Button>
        </form>
        {submitError && (
          <p role="alert" className="mt-3 font-body text-body-md text-on-error-container">
            {submitError}
          </p>
        )}
      </GlassCard>

      {state.status === 'loading' && (
        <div data-testid="contacts-loading" aria-busy="true" className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-[1.5rem] bg-surface-container-low animate-pulse" />
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
        <>
          {/* Friends pane */}
          <GlassCard as="section" radius="lg" padding="md" aria-labelledby="friends-heading">
            <h2
              id="friends-heading"
              className="font-display text-title-md font-bold text-on-surface"
            >
              Friends ({state.data.friends.length})
            </h2>
            {state.data.friends.length === 0 ? (
              <p className="mt-3 font-body text-body-md text-on-surface-variant">
                No friends yet — send a request above.
              </p>
            ) : (
              <ul aria-label="Friends" className="mt-4 flex flex-col gap-2">
                {state.data.friends.map((f) => (
                  <li
                    key={f.userId}
                    className="flex items-center justify-between gap-3 rounded-full bg-surface-container-low px-4 py-2"
                  >
                    <UserPopover
                      userId={f.userId}
                      username={f.username}
                      isFriend={true}
                      isBlocked={false}
                      onClose={() => void load()}
                      triggerClassName="px-1 py-1"
                    >
                      <span className="flex items-center gap-3">
                        <PresenceDot state={presenceFor(f.userId)} />
                        <span className="font-body text-body-md text-on-surface">{f.username}</span>
                      </span>
                    </UserPopover>
                    <div className="flex items-center gap-2">
                      <UnreadBadge
                        count={dmUnread.get(f.userId) ?? 0}
                        label={`${dmUnread.get(f.userId) ?? 0} unread from ${f.username}`}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={mutating}
                        onClick={() => void runMutation(() => removeFriend(f.userId))}
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>

          {/* Incoming requests */}
          <GlassCard as="section" radius="lg" padding="md" aria-labelledby="incoming-heading">
            <h2
              id="incoming-heading"
              className="font-display text-title-md font-bold text-on-surface"
            >
              Incoming requests ({state.data.incoming.length})
            </h2>
            {state.data.incoming.length === 0 ? (
              <p className="mt-3 font-body text-body-md text-on-surface-variant">
                No pending incoming requests.
              </p>
            ) : (
              <ul aria-label="Incoming requests" className="mt-4 flex flex-col gap-2">
                {state.data.incoming.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-full bg-surface-container-low px-4 py-2"
                  >
                    <span className="font-body text-body-md text-on-surface">
                      {r.from.username}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={mutating}
                        onClick={() => void runMutation(() => acceptRequest(r.id))}
                      >
                        Accept
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={mutating}
                        onClick={() => void runMutation(() => rejectRequest(r.id))}
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>

          {/* Outgoing requests */}
          <GlassCard as="section" radius="lg" padding="md" aria-labelledby="outgoing-heading">
            <h2
              id="outgoing-heading"
              className="font-display text-title-md font-bold text-on-surface"
            >
              Outgoing requests ({state.data.outgoing.length})
            </h2>
            {state.data.outgoing.length === 0 ? (
              <p className="mt-3 font-body text-body-md text-on-surface-variant">
                No outgoing requests.
              </p>
            ) : (
              <ul aria-label="Outgoing requests" className="mt-4 flex flex-col gap-2">
                {state.data.outgoing.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-full bg-surface-container-low px-4 py-2"
                  >
                    <span className="font-body text-body-md text-on-surface">{r.to.username}</span>
                    <span className="font-body text-body-sm text-on-surface-variant">Pending</span>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
}
