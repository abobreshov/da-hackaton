import { createFileRoute, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { WsEvent } from '@/lib/ws-events';
import { usePresenceMap, type PresenceStatus } from '@/hooks/usePresenceMap';
import { PresenceDot } from '@/components/presence-dot';

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
 * Room detail page — M2 scope.
 *
 * Emits `room.join { roomId }` on mount, receives `{ room, members }` via
 * the ack callback. Leaves with `room.leave { roomId }` on unmount. No HTTP
 * call because the WS ack already carries everything we render; this avoids
 * a second round-trip and keeps the join + member snapshot transactional.
 *
 * Chat composer lands in a later milestone — we render a placeholder instead
 * so the page has a meaningful empty state.
 */
export function RoomRoute() {
  const { roomId: roomIdRaw } = useParams({ from: '/_auth/rooms/$roomId' });
  const roomId = Number(roomIdRaw);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const presence = usePresenceMap();

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
      // Ack shape didn't match — surface as a generic error so the UI
      // never gets stuck on the skeleton.
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
      <section
        className="animate-fade-up rounded-[2rem] bg-error-container/70 px-8 py-10 shadow-ambient"
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
      </section>
    );
  }

  const { room, members } = state;

  return (
    <div className="animate-fade-up grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_20rem]">
      {/* Main column — room header + chat placeholder */}
      <section
        className="rounded-[2rem] bg-surface-container-lowest/80 px-8 py-10 shadow-ambient backdrop-blur-xl"
        aria-labelledby="room-heading"
      >
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

        <div
          className="mt-10 flex flex-col items-center justify-center gap-2 rounded-[1.5rem] bg-surface-container-low px-6 py-14 text-center"
          role="note"
        >
          <p className="font-display text-title-md font-semibold text-on-surface">
            Room chat coming soon
          </p>
          <p className="max-w-md font-body text-body-md text-on-surface-variant">
            Live messaging lands in the next milestone. Presence and
            membership are already wired — hang tight.
          </p>
        </div>
      </section>

      {/* Sidebar — members pane */}
      <aside
        className="rounded-[2rem] bg-surface-container-lowest/80 p-6 shadow-ambient backdrop-blur-xl"
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
      </aside>
    </div>
  );
}
