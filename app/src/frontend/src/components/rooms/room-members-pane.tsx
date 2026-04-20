import { GlassCard } from '@/components/ui/surface';
import { PresenceDot } from '@/components/presence-dot';
import { UserPopover } from '@/components/user-popover';
import type { PresenceStatus } from '@/hooks/usePresenceMap';

/**
 * Sidebar pane listing members of a room.
 *
 * Extracted from `routes/_auth/rooms/$roomId.tsx` so the orchestrator route
 * stays focused on join/ack + role gating; the pane only renders a list and
 * delegates per-row affordances to `<UserPopover>`.
 *
 * Wiring contract:
 *   - `presenceFor(userId)` returns the live presence (online/afk/offline)
 *     from the shared `usePresenceMap` store. Passed in (rather than read
 *     inside) so the pane stays a pure render layer — easier to test and to
 *     reuse in DM / friend list contexts later.
 *   - `isFriend` / `isBlocked` aren't on the room-join ack payload; the
 *     popover defaults to `false` and the BFF surfaces the correct 409 on
 *     duplicate add-friend / block actions.
 */
export interface RoomMemberView {
  userId: number;
  username: string;
}

export interface RoomMembersPaneProps {
  members: readonly RoomMemberView[];
  presenceFor: (userId: number) => PresenceStatus;
}

export function RoomMembersPane({ members, presenceFor }: RoomMembersPaneProps) {
  return (
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
  );
}
