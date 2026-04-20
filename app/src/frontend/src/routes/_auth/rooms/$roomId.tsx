import { createFileRoute, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { WsEvent } from '@/lib/ws-events';
import { usePresenceMap, type PresenceStatus } from '@/hooks/usePresenceMap';
import { PresenceDot } from '@/components/presence-dot';
import { useMessages } from '@/hooks/useMessages';
import { useSession } from '@/hooks/useSession';
import { MessageList } from '@/components/chat/message-list';
import { MessageComposer } from '@/components/chat/message-composer';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/surface';

export const Route = createFileRoute('/_auth/rooms/$roomId')({
  component: RoomRoute,
});

interface RoomMember {
  userId: number;
  username: string;
}

interface RoomSummary {
  id: number;
  name: string;
  description: string | null;
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

/**
 * Room detail page.
 *
 * Joins the room over WS on mount (receives room + members snapshot in the
 * ack), then hydrates the chat viewport via HTTP (see `useMessages`). The
 * WS channel pushes `message.new|edited|deleted` for live updates, and the
 * composer routes sends back through the same socket.
 *
 * "Manage room" button is a stub — the modal lands in a follow-up agent.
 * It stays wired here so the header layout + data-testid are stable for
 * the e2e and later integration work.
 */
export function RoomRoute() {
  const { roomId: roomIdRaw } = useParams({ from: '/_auth/rooms/$roomId' });
  const roomId = Number(roomIdRaw);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const presence = usePresenceMap();
  const session = useSession((s) => s.session);
  const currentUserId = session?.type === 'user' ? (session.id ?? null) : null;

  const roomIdForMessages = Number.isFinite(roomId) ? roomId : undefined;
  const { messages, sendMessage, loadOlder, hasMore } = useMessages({
    roomId: roomIdForMessages,
  });

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

    socket.emit(WsEvent.client.roomJoin, { roomId }, (ack: RoomJoinAck | undefined) => {
      if (!active) return;
      if (ack?.error) {
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
        <p className="mt-3 font-body text-body-lg text-on-error-container">
          {state.error.message}
        </p>
      </GlassCard>
    );
  }

  const { room, members } = state;

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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="room-manage-button"
            onClick={() => {
              /* Manage-room modal wired up in a follow-up milestone. */
            }}
          >
            Manage room
          </Button>
        </header>

        <div className="mt-8 flex flex-1 flex-col overflow-hidden rounded-[1.5rem] bg-surface-container-low">
          <div className="flex-1 overflow-hidden">
            <MessageList
              messages={messages}
              currentUserId={currentUserId}
              hasMore={hasMore}
              onLoadOlder={loadOlder}
            />
          </div>
          <div className="border-0 px-4 pb-4 pt-2">
            <MessageComposer
              onSubmit={async (body) => {
                await sendMessage({ body });
              }}
            />
          </div>
        </div>
      </GlassCard>

      {/* Sidebar — members pane */}
      <GlassCard
        as="aside"
        radius="lg"
        padding="md"
        aria-labelledby="room-members-heading"
      >
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
              <PresenceDot state={presenceFor(m.userId)} />
              <span className="font-body text-body-md text-on-surface">{m.username}</span>
            </li>
          ))}
        </ul>
      </GlassCard>
    </div>
  );
}
