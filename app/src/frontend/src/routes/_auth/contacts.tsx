import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listFriends,
  sendFriendRequest,
  acceptRequest,
  rejectRequest,
  removeFriend,
  type FriendsResponse,
} from '@/lib/friends';
import { searchUsers, type UserSearchHit } from '@/lib/users';
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
  // ── Autocomplete state for the add-friend input ──
  // `suggestions` holds the latest search hits; `suggestOpen` gates the
  // dropdown visibility so clicking outside / blurring hides it without
  // dropping the list (re-focus re-opens with whatever's current).
  // `activeIndex` is the keyboard cursor (-1 = no row highlighted).
  const [suggestions, setSuggestions] = useState<UserSearchHit[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  // Debounce handle + in-flight sequence id so a stale slow response never
  // clobbers the latest one when the user is still typing.
  const debounceRef = useRef<number | null>(null);
  const searchSeqRef = useRef(0);
  const presenceIds = useMemo<number[]>(() => {
    if (state.status !== 'ok') return [];
    const ids = new Set<number>();
    for (const f of state.data.friends) ids.add(f.userId);
    for (const r of state.data.incoming) ids.add(r.from.userId);
    for (const r of state.data.outgoing) ids.add(r.to.userId);
    return [...ids];
  }, [state]);
  const presence = usePresenceMap(presenceIds);
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

  // Debounced search on every keystroke. 200 ms felt best in manual testing
  // — short enough to feel live, long enough that a fast typist doesn't
  // burn a roundtrip per character. `searchSeqRef` discards any response
  // that was overtaken by a later one.
  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    const trimmed = username.trim();
    if (!trimmed) {
      setSuggestions([]);
      setActiveIndex(-1);
      return;
    }
    const seq = ++searchSeqRef.current;
    debounceRef.current = window.setTimeout(() => {
      void searchUsers(trimmed, 8).then((hits) => {
        if (seq !== searchSeqRef.current) return;
        setSuggestions(hits);
        setActiveIndex(hits.length > 0 ? 0 : -1);
      });
    }, 200);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [username]);

  const pickSuggestion = (hit: UserSearchHit): void => {
    setUsername(hit.name);
    setSuggestions([]);
    setSuggestOpen(false);
    setActiveIndex(-1);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const uname = username.trim();
    if (!uname || mutating) return;
    setSuggestOpen(false);
    setSubmitError(null);
    setMutating(true);
    try {
      await sendFriendRequest(uname);
      setUsername('');
      setSuggestions([]);
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
          <div className="relative flex-1">
            <Label htmlFor="friend-username">Add friend by username</Label>
            {/*
              Minimal combobox — `role="combobox"` on the input, `role="listbox"`
              on the dropdown, `role="option"` on each hit. Keeps the a11y tree
              close to a native <datalist> without the styling limitations.
              Dropdown position is absolute against the relative parent; the
              input itself is rendered by `<Input>`.
            */}
            <Input
              id="friend-username"
              name="username"
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestOpen && suggestions.length > 0}
              aria-controls="friend-username-listbox"
              aria-activedescendant={
                activeIndex >= 0 && suggestions[activeIndex]
                  ? `friend-username-option-${suggestions[activeIndex].id}`
                  : undefined
              }
              placeholder="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setSuggestOpen(true);
              }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => {
                // Delay close so a mousedown on an option still registers
                // — `onClick` on the option re-opens state synchronously
                // anyway via `pickSuggestion`.
                window.setTimeout(() => setSuggestOpen(false), 120);
              }}
              onKeyDown={(e) => {
                if (!suggestOpen || suggestions.length === 0) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveIndex((i) => (i + 1) % suggestions.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
                } else if (e.key === 'Enter' && activeIndex >= 0) {
                  const hit = suggestions[activeIndex];
                  if (hit) {
                    e.preventDefault();
                    pickSuggestion(hit);
                  }
                } else if (e.key === 'Escape') {
                  setSuggestOpen(false);
                }
              }}
              disabled={mutating}
            />
            {suggestOpen && suggestions.length > 0 && (
              <ul
                id="friend-username-listbox"
                role="listbox"
                data-testid="friend-username-listbox"
                className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-[1rem] bg-surface-container-high py-1 shadow-ambient"
              >
                {suggestions.map((hit, idx) => (
                  <li
                    key={hit.id}
                    id={`friend-username-option-${hit.id}`}
                    role="option"
                    aria-selected={idx === activeIndex}
                    data-testid={`friend-username-option-${hit.id}`}
                    className={[
                      'cursor-pointer px-4 py-2 font-body text-body-md text-on-surface',
                      idx === activeIndex
                        ? 'bg-primary/15 text-on-surface'
                        : 'hover:bg-surface-container',
                    ].join(' ')}
                    // Use onMouseDown so the input's blur (which fires first on
                    // a regular click) doesn't close the dropdown before the
                    // click completes.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickSuggestion(hit);
                    }}
                  >
                    {hit.name}
                  </li>
                ))}
              </ul>
            )}
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
                    data-testid="friend-row"
                    data-username={f.username}
                    data-user-id={f.userId}
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
