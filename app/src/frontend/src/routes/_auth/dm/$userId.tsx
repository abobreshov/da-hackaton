import { createFileRoute, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ErrorCode } from '@app/contracts';
import { PresenceDot } from '@/components/presence-dot';
import { usePresenceMap, type PresenceStatus } from '@/hooks/usePresenceMap';
import { useMessages } from '@/hooks/useMessages';
import { useAutoMarkRead } from '@/hooks/useAutoMarkRead';
import { useSession } from '@/hooks/useSession';
import { MessageList } from '@/components/chat/message-list';
import { MessageComposer } from '@/components/chat/message-composer';
import { GlassCard } from '@/components/ui/surface';
import { Button } from '@/components/ui/button';
import { listFriends, type FriendSummary } from '@/lib/friends';
import { reportUser } from '@/lib/users';
import type { Message } from '@/lib/messages';

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
  const presence = usePresenceMap(Number.isFinite(userId) ? [userId] : []);
  const session = useSession((s) => s.session);
  const currentUserId = session?.type === 'user' ? (session.id ?? null) : null;
  const [frozen, setFrozen] = useState(false);
  const [frozenMessage, setFrozenMessage] = useState<string | null>(null);
  const [friend, setFriend] = useState<FriendSummary | null>(null);

  const dmUserId = Number.isFinite(userId) ? userId : undefined;
  const { messages, sendMessage, editMessage, deleteMessage, loadOlder, hasMore, error, attachmentsOf } =
    useMessages({
      dmUserId,
    });

  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [reportTarget, setReportTarget] = useState<Message | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Message | null>(null);

  const handleReport = (m: Message): void => {
    setReportTarget(m);
    setReportReason('');
    setReportError(null);
  };

  const handleSubmitReport = async (): Promise<void> => {
    if (!reportTarget) return;
    setReportSubmitting(true);
    setReportError(null);
    try {
      await reportUser({
        targetType: 'message',
        targetId: Number(reportTarget.id),
        reason: reportReason.trim(),
      });
      setReportTarget(null);
      setReportReason('');
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'Failed to submit report.');
    } finally {
      setReportSubmitting(false);
    }
  };

  const handleConfirmDelete = async (): Promise<void> => {
    if (!confirmDelete) return;
    try {
      await deleteMessage(confirmDelete.id);
    } finally {
      setConfirmDelete(null);
    }
  };

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
            attachmentsOf={attachmentsOf}
            onReply={(m) => setReplyingTo(m)}
            onReport={handleReport}
            onDelete={(m) => setConfirmDelete(m)}
            onEditSubmit={async (id, body) => {
              await editMessage(id, body);
            }}
          />
        </div>
        {replyingTo && (
          <div
            data-testid="reply-preview"
            className="mx-4 mt-2 flex items-center justify-between gap-3 rounded-full bg-surface-container px-4 py-2 font-body text-body-sm text-on-surface-variant"
          >
            <span className="truncate">
              Replying to{' '}
              <span className="font-semibold text-on-surface">{replyingTo.author.username}</span>:{' '}
              {replyingTo.deletedAt ? 'deleted message' : replyingTo.body}
            </span>
            <button
              type="button"
              data-testid="reply-preview-cancel"
              onClick={() => setReplyingTo(null)}
              className="rounded-full bg-surface-container-low px-3 py-1 font-display text-label-sm text-on-surface hover:bg-surface-container-high"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="px-4 pb-4 pt-2">
          <MessageComposer
            frozen={frozen}
            attachmentTarget={
              Number.isFinite(userId) && userId !== currentUserId
                ? { kind: 'dm', peerUserId: userId }
                : undefined
            }
            replyingTo={replyingTo}
            onCancelReply={() => setReplyingTo(null)}
            onSubmit={async (body, attachmentIds) => {
              try {
                const replyToId = replyingTo?.id;
                await sendMessage({ body, attachmentIds, replyToId });
                setReplyingTo(null);
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

      {/* Both modals portal'd to document.body — the parent wrapper uses
          `animate-fade-up` which applies a non-`none` transform and that
          creates a new containing block for `position:fixed` descendants.
          Result without portal: modal centres over the chat column mid-
          scroll instead of the viewport. */}
      {confirmDelete
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-delete-title"
              data-testid="confirm-delete-dialog"
              className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/40 backdrop-blur-sm"
              onClick={(e) => {
                if (e.target === e.currentTarget) setConfirmDelete(null);
              }}
            >
              <div className="mx-4 w-full max-w-md rounded-[1.5rem] bg-surface-container px-6 py-5 shadow-ambient">
                <h2
                  id="confirm-delete-title"
                  className="font-display text-title-md font-semibold text-on-surface"
                >
                  Delete this message?
                </h2>
                <p className="mt-2 font-body text-body-md text-on-surface-variant">
                  The message will be replaced with a tombstone for everyone.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmDelete(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      void handleConfirmDelete();
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {reportTarget
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="report-message-title"
              data-testid="report-message-dialog"
              className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/40 backdrop-blur-sm"
              onClick={(e) => {
                if (e.target === e.currentTarget) setReportTarget(null);
              }}
            >
              <div className="mx-4 w-full max-w-md rounded-[1.5rem] bg-surface-container px-6 py-5 shadow-ambient">
                <h2
                  id="report-message-title"
                  className="font-display text-title-md font-semibold text-on-surface"
                >
                  Report message
                </h2>
                <p className="mt-2 font-body text-body-sm text-on-surface-variant">
                  Tell the moderators what&apos;s wrong with this message.
                </p>
                <textarea
                  aria-label="Reason"
                  data-testid="report-message-reason"
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="mt-3 min-h-[6rem] w-full resize-y rounded-[1rem] bg-surface-container-low px-4 py-3 font-body text-body-md text-on-surface focus:bg-surface-container focus:outline-none"
                  placeholder="What's the problem?"
                />
                {reportError && (
                  <p className="mt-2 font-body text-body-sm text-error" role="alert">
                    {reportError}
                  </p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setReportTarget(null)}
                    disabled={reportSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      void handleSubmitReport();
                    }}
                    disabled={reportSubmitting || reportReason.trim().length === 0}
                  >
                    Submit report
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
