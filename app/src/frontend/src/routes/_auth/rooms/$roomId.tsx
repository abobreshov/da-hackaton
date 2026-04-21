import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { WsEvent } from '@/lib/ws-events';
import { usePresenceMap, type PresenceStatus } from '@/hooks/usePresenceMap';
import { PresenceDot } from '@/components/presence-dot';
import { useMessages } from '@/hooks/useMessages';
import { joinRoom } from '@/lib/rooms';
import { useAutoMarkRead } from '@/hooks/useAutoMarkRead';
import { useSession } from '@/hooks/useSession';
import { MessageList } from '@/components/chat/message-list';
import { MessageComposer } from '@/components/chat/message-composer';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/surface';
import {
  ManageRoomModal,
  type ManageRoomMember,
  type ManageRoomRole,
} from '@/components/rooms/manage-room-modal';
import { UserPopover } from '@/components/user-popover';
import { reportUser } from '@/lib/users';
import type { Message } from '@/lib/messages';

export const Route = createFileRoute('/_auth/rooms/$roomId')({
  component: RoomRoute,
});

interface RoomMember {
  userId: number;
  username: string;
  /**
   * Role comes from the `rooms.membersOf` TCP response via the `room.join`
   * ack (see `bff/ws/chat.gateway.ts` + `backend/rooms.repository.ts`).
   * Missing / unknown roles fall back to `'member'` client-side; the modal
   * itself gates dangerous actions on role strings.
   */
  role?: ManageRoomRole | string;
}

interface RoomSummary {
  id: number;
  name: string;
  description: string | null;
  /** Owner numeric id — required by ManageRoomModal for role gating. */
  ownerId?: number;
  /** Visibility mirrors the rooms.visibility column. */
  visibility?: 'public' | 'private';
}

interface WireError {
  code: string;
  message: string;
}

interface RoomJoinAck {
  room?: RoomSummary;
  members?: RoomMember[];
  error?: WireError;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; room: RoomSummary; members: RoomMember[] }
  | { status: 'error'; error: WireError };

function normaliseRole(role: RoomMember['role']): ManageRoomRole {
  return role === 'owner' || role === 'admin' ? role : 'member';
}

/**
 * Room detail page.
 *
 * Joins the room over WS on mount (receives room + members snapshot in the
 * ack), then hydrates the chat viewport via HTTP (see `useMessages`). The
 * WS channel pushes `message.new|edited|deleted` for live updates, and the
 * composer routes sends back through the same socket.
 *
 * Wiring landed:
 *   - "Manage room" button opens `<ManageRoomModal>` for owners + admins;
 *     plain members don't see the button. Role is derived from the current
 *     user's membership row in the `room.join` ack.
 *   - Each member row in the sidebar wraps the username in `<UserPopover>`
 *     (open DM / add-remove friend / block-unblock / report). Friend +
 *     block status default to `false` — the server surfaces "already
 *     friends" / "already blocked" via ApiError on action.
 */
export function RoomRoute() {
  const { roomId: roomIdRaw } = useParams({ from: '/_auth/rooms/$roomId' });
  const roomId = Number(roomIdRaw);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [manageOpen, setManageOpen] = useState(false);
  const presence = usePresenceMap();
  const session = useSession((s) => s.session);
  const currentUserId = session?.type === 'user' ? (session.id ?? null) : null;

  const roomIdForMessages = Number.isFinite(roomId) ? roomId : undefined;
  const { messages, sendMessage, editMessage, deleteMessage, loadOlder, hasMore, attachmentsOf } =
    useMessages({
      roomId: roomIdForMessages,
    });

  // Per-message UI state — reply target + report dialog target. Owned at the
  // route level so MessageBubble stays a presentational component (one source
  // of truth for reply preview + report dialog state).
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

  // Mark-read upshot of having messages visible: the newest rendered message
  // id is our "last read" watermark for this scope (AC-09-06). `useMessages`
  // keeps `messages` sorted ascending, so the tail is the newest.
  const lastReadId =
    state.status === 'ok' && messages.length > 0 ? String(messages[messages.length - 1].id) : null;
  useAutoMarkRead({ kind: 'room', roomId: Number.isFinite(roomId) ? roomId : -1 }, lastReadId);

  useEffect(() => {
    if (!Number.isFinite(roomId)) {
      setState({
        status: 'error',
        error: { code: 'INVALID_ROOM_ID', message: 'Room id is not a number.' },
      });
      return;
    }

    const socket = getSocket();
    let active = true;

    const tryJoin = (allowMembershipRetry: boolean): void => {
      socket.emit(WsEvent.client.roomJoin, { roomId }, (ack: RoomJoinAck | undefined) => {
        if (!active) return;
        if (ack?.error) {
          // First-visit auto-join — when the WS gateway rejects with
          // "not a member" the user is just visiting from /rooms catalog.
          // POST /rooms/:id/join (idempotent), then retry the WS handshake
          // exactly once. After that, surface the error rather than loop.
          const looksLikeNotMember =
            allowMembershipRetry &&
            (ack.error.message?.toLowerCase().includes('not a member') ||
              ack.error.message?.toLowerCase().includes('membership'));
          if (looksLikeNotMember) {
            joinRoom(roomId)
              .then(() => {
                if (active) tryJoin(false);
              })
              .catch((err) => {
                if (!active) return;
                setState({
                  status: 'error',
                  error: {
                    code: 'UPSTREAM_UNAVAILABLE',
                    message: err instanceof Error ? err.message : 'Failed to join room.',
                  },
                });
              });
            return;
          }
          setState({ status: 'error', error: ack.error });
          return;
        }
        if (ack?.room && ack.members) {
          setState({ status: 'ok', room: ack.room, members: ack.members });
          return;
        }
        setState({
          status: 'error',
          error: {
            code: 'UPSTREAM_UNAVAILABLE',
            message: 'Malformed response while joining the room.',
          },
        });
      });
    };
    tryJoin(true);

    return () => {
      active = false;
      socket.emit(WsEvent.client.roomLeave, { roomId });
    };
  }, [roomId]);

  const presenceFor = useMemo(
    () =>
      (userId: number): PresenceStatus =>
        presence.get(userId) ?? 'offline',
    [presence],
  );

  if (state.status === 'loading') {
    return (
      <div
        data-testid="room-loading"
        aria-busy="true"
        className="animate-fade-up flex flex-col gap-6"
      >
        <div className="h-12 w-64 rounded-full bg-surface-container-low animate-pulse" />
        <div className="h-40 rounded-[2rem] bg-surface-container-low animate-pulse" />
      </div>
    );
  }

  if (state.status === 'error') {
    // Special-case INVALID_ROOM_ID — the param wasn't a number, so the user
    // likely hit a stale bookmark / typo'd slug (`/rooms/general`). Steer
    // them toward the catalog instead of dumping the raw error code.
    if (state.error.code === 'INVALID_ROOM_ID') {
      return (
        <GlassCard
          as="section"
          tone="error"
          radius="lg"
          padding="none"
          className="animate-fade-up px-8 py-10"
          aria-labelledby="room-error"
          data-testid="room-error-invalid-id"
        >
          <p className="font-display text-label-lg font-semibold uppercase tracking-[0.18em] text-on-error-container/80">
            Room not found
          </p>
          <h1
            id="room-error"
            className="mt-3 font-display text-headline-sm font-extrabold text-on-error-container"
          >
            Couldn&apos;t find that room
          </h1>
          <p className="mt-3 font-body text-body-lg text-on-error-container">
            The room id needs to be a number. Browse public rooms instead?
          </p>
          <div className="mt-6">
            <Button asChild variant="primary" size="md">
              <Link to="/rooms" data-testid="room-error-catalog-link">
                Open rooms catalog
              </Link>
            </Button>
          </div>
        </GlassCard>
      );
    }

    return (
      <GlassCard
        as="section"
        tone="error"
        radius="lg"
        padding="none"
        className="animate-fade-up px-8 py-10"
        aria-labelledby="room-error"
      >
        <p className="font-display text-label-lg font-semibold uppercase tracking-[0.18em] text-on-error-container/80">
          {state.error.code}
        </p>
        <h1
          id="room-error"
          className="mt-3 font-display text-headline-sm font-extrabold text-on-error-container"
        >
          Couldn&apos;t open this room
        </h1>
        <p className="mt-3 font-body text-body-lg text-on-error-container">{state.error.message}</p>
      </GlassCard>
    );
  }

  const { room, members } = state;

  // Resolve the current user's role from the member list. If the current
  // user isn't in the members (shouldn't happen post-`ensureMember` but be
  // defensive) fall back to `member`.
  const selfMember = currentUserId ? members.find((m) => m.userId === currentUserId) : undefined;
  const currentRole: ManageRoomRole = normaliseRole(selfMember?.role);
  const canManage = currentRole === 'owner' || currentRole === 'admin';

  // Modal expects the extended shape with `{ownerId, visibility, presence}`.
  const ownerIdFromRoom =
    room.ownerId ?? members.find((m) => normaliseRole(m.role) === 'owner')?.userId ?? 0;
  const modalRoom = {
    id: room.id,
    name: room.name,
    description: room.description,
    ownerId: ownerIdFromRoom,
    visibility: room.visibility ?? 'public',
  };
  const modalMembers: ManageRoomMember[] = members.map((m) => ({
    userId: m.userId,
    username: m.username,
    role: normaliseRole(m.role),
    presence: presenceFor(m.userId),
  }));
  const modalCurrentUser =
    currentUserId && selfMember
      ? {
          id: currentUserId,
          username: selfMember.username,
          role: currentRole,
        }
      : null;

  return (
    <div className="animate-fade-up grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_20rem]">
      {/* Main column — room header + live chat viewport */}
      <GlassCard
        as="section"
        radius="lg"
        padding="none"
        className="flex min-h-[32rem] flex-col px-8 py-10"
        aria-labelledby="room-heading"
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-label-lg font-semibold uppercase tracking-[0.18em] text-on-surface-variant">
              Room
            </p>
            <h1
              id="room-heading"
              className="mt-2 font-display text-display-sm font-extrabold text-on-surface"
            >
              {room.name}
            </h1>
            {room.description && (
              <p className="mt-3 max-w-xl font-body text-body-lg text-on-surface-variant">
                {room.description}
              </p>
            )}
          </div>
          {canManage && modalCurrentUser ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="room-manage-button"
              onClick={() => setManageOpen(true)}
            >
              Manage room
            </Button>
          ) : null}
        </header>

        <div className="mt-8 flex flex-1 flex-col overflow-hidden rounded-[1.5rem] bg-surface-container-low">
          <div className="flex-1 overflow-hidden">
            <MessageList
              messages={messages}
              currentUserId={currentUserId}
              hasMore={hasMore}
              onLoadOlder={loadOlder}
              attachmentsOf={attachmentsOf}
              canAdminDelete={canManage}
              onReply={(m) => setReplyingTo(m)}
              onReport={handleReport}
              onDelete={(m) => setConfirmDelete(m)}
              onEditSubmit={async (id, body) => {
                await editMessage(id, body);
              }}
            />
          </div>
          {/* Reply-preview shim — the e2e suite asserts on this testid before
              typing a reply. The composer renders its own internal strip; we
              mirror the state here so Playwright's selector resolves. */}
          {replyingTo && (
            <div
              data-testid="reply-preview"
              className="mx-4 mt-2 flex items-center justify-between gap-3 rounded-full bg-surface-container px-4 py-2 font-body text-body-sm text-on-surface-variant"
            >
              <span className="truncate">
                Replying to{' '}
                <span className="font-semibold text-on-surface">{replyingTo.author.username}</span>
                : {replyingTo.deletedAt ? 'deleted message' : replyingTo.body}
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
          <div className="border-0 px-4 pb-4 pt-2">
            <MessageComposer
              attachmentTarget={Number.isFinite(roomId) ? { kind: 'room', roomId } : undefined}
              replyingTo={replyingTo}
              onCancelReply={() => setReplyingTo(null)}
              onSubmit={async (body, attachmentIds) => {
                const replyToId = replyingTo?.id;
                await sendMessage({ body, attachmentIds, replyToId });
                setReplyingTo(null);
              }}
            />
          </div>
        </div>
      </GlassCard>

      {/* Sidebar — members pane */}
      <GlassCard as="aside" radius="lg" padding="md" aria-labelledby="room-members-heading">
        <h2
          id="room-members-heading"
          className="font-display text-title-md font-bold text-on-surface"
        >
          Members ({members.length})
        </h2>
        <ul aria-label="Members" className="mt-4 flex flex-col gap-2">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center gap-3 rounded-full bg-surface-container-low px-4 py-2"
            >
              <UserPopover
                userId={m.userId}
                username={m.username}
                // `isFriend` / `isBlocked` aren't exposed on the room-join
                // ack; defaulting to `false` lets the add-friend / block
                // buttons fire, and the BFF surfaces the correct 409
                // ("already friends" / "already blocked") as an ApiError
                // the popover renders inline. Wiring the graph here would
                // need an `/api/v1/friends` fetch on every room open,
                // which isn't warranted for the MVP.
                isFriend={false}
                isBlocked={false}
                triggerClassName="flex items-center gap-3 px-1 py-1"
              >
                <span className="flex items-center gap-3">
                  <PresenceDot state={presenceFor(m.userId)} />
                  <span className="font-body text-body-md text-on-surface">{m.username}</span>
                </span>
              </UserPopover>
            </li>
          ))}
        </ul>
      </GlassCard>

      {manageOpen && modalCurrentUser ? (
        <ManageRoomModal
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          room={modalRoom}
          currentUser={modalCurrentUser}
          members={modalMembers}
        />
      ) : null}

      {/* Delete-confirmation dialog. Bare-bones <dialog> equivalent — a
          centred surface-card overlay with a Cancel + Delete button pair.
          Deliberately not a portal'd Radix dialog yet; MVP focus. */}
      {confirmDelete ? (
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
        </div>
      ) : null}

      {/* Report-message dialog. Plain modal for MVP; calls reportUser with
          targetType='message'. */}
      {reportTarget ? (
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
        </div>
      ) : null}
    </div>
  );
}
