import { createFileRoute, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ErrorCode } from '@app/contracts';
import { PresenceDot } from '@/components/presence-dot';
import { usePresenceMap, type PresenceStatus } from '@/hooks/usePresenceMap';
import { useMessages } from '@/hooks/useMessages';
import { useAutoMarkRead } from '@/hooks/useAutoMarkRead';
import { useSession } from '@/hooks/useSession';
import { MessageList } from '@/components/chat/message-list';
import { MessageComposer } from '@/components/chat/message-composer';
import { GlassCard } from '@/components/ui/surface';
import { listFriends, type FriendSummary } from '@/lib/friends';

export const Route = createFileRoute('/_auth/dm/$userId')({
  component: DmRoute,
});

/**
 * Direct-message viewport keyed by the other user's id.
 *
 * There's no dedicated DM-header endpoint today, so the username comes from
 * the friends list (the only place the FE already has a user id → username
 * map today). If the recipient isn't in the friends list we fall back to
 * "User #id" — the backend will refuse the send with `FRIEND_REQUIRED` and
 * the error path will surface the real message.
 *
 * DM-frozen handling: we optimistically render the composer and rely on the
 * send path to surface `DM_FROZEN`. Once that fires we latch `frozen` and
 * disable the composer until the page is reloaded. No dedicated GET exists
 * for channel metadata yet.
 */
export function DmRoute() {
  const { userId: userIdRaw } = useParams({ from: '/_auth/dm/$userId' });
  const userId = Number(userIdRaw);
  const presence = usePresenceMap();
  const session = useSession((s) => s.session);
  const currentUserId = session?.type === 'user' ? (session.id ?? null) : null;
  const [frozen, setFrozen] = useState(false);
  const [frozenMessage, setFrozenMessage] = useState<string | null>(null);
  const [friend, setFriend] = useState<FriendSummary | null>(null);

  const dmUserId = Number.isFinite(userId) ? userId : undefined;
  const { messages, sendMessage, loadOlder, hasMore, error } = useMessages({
    dmUserId,
  });

  // Auto-mark-read the conversation whenever the newest rendered message id
  // changes (AC-09-06). If the DM channel has not been provisioned yet the
  // backend handles it as a no-op (see UnreadTcpController).
  const lastReadId = messages.length > 0 ? String(messages[messages.length - 1].id) : null;
  useAutoMarkRead({ kind: 'dm', peerUserId: Number.isFinite(userId) ? userId : -1 }, lastReadId);

  useEffect(() => {
    let active = true;
    // Best-effort friends hydration for the header label. If it fails we
    // silently fall back to "User #id" — the DM works either way.
    listFriends()
      .then((res) => {
        if (!active) return;
        const match = res.friends.find((f) => f.userId === userId);
        if (match) setFriend(match);
      })
      .catch(() => {
        /* no-op, header label just falls back */
      });
    return () => {
      active = false;
    };
  }, [userId]);

  // If the initial HTTP fetch comes back with DM_FROZEN, latch immediately —
  // `useMessages` surfaces the ApiError via its `error` field.
  useEffect(() => {
    if (!error) return;
    const code = (error as Error & { code?: string }).code;
    if (code === ErrorCode.DM_FROZEN) {
      setFrozen(true);
      setFrozenMessage(error.message);
    }
  }, [error]);

  if (!Number.isFinite(userId)) {
    return (
      <section className="animate-fade-up rounded-[2rem] bg-error-container/70 px-8 py-10 shadow-ambient">
        <h1 className="font-display text-headline-sm font-extrabold text-on-error-container">
          Invalid user id
        </h1>
      </section>
    );
  }

  const username = friend?.username ?? `User #${userId}`;
  const presenceState: PresenceStatus = presence.get(userId) ?? 'offline';

  return (
    <div className="animate-fade-up flex min-h-[32rem] flex-col gap-6" data-testid="dm-route">
      <GlassCard
        as="header"
        radius="lg"
        padding="none"
        className="flex items-center gap-4 px-8 py-6"
        aria-labelledby="dm-heading"
      >
        <PresenceDot state={presenceState} />
        <div>
          <p className="font-display text-label-lg font-semibold uppercase tracking-[0.18em] text-on-surface-variant">
            Direct message
          </p>
          <h1
            id="dm-heading"
            className="mt-1 font-display text-display-sm font-extrabold text-on-surface"
          >
            {username}
          </h1>
        </div>
      </GlassCard>

      {frozen && (
        <div
          data-testid="dm-frozen-banner"
          role="alert"
          className="rounded-[1.5rem] bg-error-container/70 px-6 py-4 shadow-ambient"
        >
          <p className="font-display text-title-md font-semibold text-on-error-container">
            You cannot message this user
          </p>
          {frozenMessage && (
            <p className="mt-1 font-body text-body-md text-on-error-container">{frozenMessage}</p>
          )}
        </div>
      )}

      <GlassCard
        as="section"
        radius="lg"
        padding="none"
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="flex-1 overflow-hidden">
          <MessageList
            messages={messages}
            currentUserId={currentUserId}
            hasMore={hasMore}
            onLoadOlder={loadOlder}
          />
        </div>
        <div className="px-4 pb-4 pt-2">
          <MessageComposer
            frozen={frozen}
            onSubmit={async (body) => {
              try {
                await sendMessage({ body });
              } catch (e) {
                const code = (e as Error & { code?: string }).code;
                if (code === ErrorCode.DM_FROZEN) {
                  setFrozen(true);
                  setFrozenMessage((e as Error).message);
                  // Swallow — the banner already surfaces the failure.
                  return;
                }
                // Re-throw so the composer keeps the input text for retry.
                throw e;
              }
            }}
          />
        </div>
      </GlassCard>
    </div>
  );
}
