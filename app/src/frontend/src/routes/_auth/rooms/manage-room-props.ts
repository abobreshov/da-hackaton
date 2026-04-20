import type { PresenceStatus } from '@/hooks/usePresenceMap';
import type {
  ManageRoomCurrentUser,
  ManageRoomMember,
  ManageRoomRole,
  ManageRoomRoom,
} from '@/components/rooms/manage-room-modal';

/**
 * Pure props-builder for `<ManageRoomModal>`.
 *
 * Lives beside the route file (not in components/) because it's route-level
 * glue between the `room.join` ack shape and the modal's prop shape — and
 * keeping it colocated makes the orchestrator route easy to read.
 *
 * Regression note (CR N7): `room.ownerId` → owner-member-id fallback no
 * longer defaults to `0`. A numeric `0` is a valid-looking user id that
 * would short-circuit `currentUser.id === ownerId` ownership checks to
 * `false` in the healthy case but `true` if a user ever ends up with id 0;
 * worse, `ownerIdFromRoom || something` in caller code silently swaps 0
 * for a fallback. Returning `null` forces every consumer to handle the
 * "owner is unknown" case explicitly and makes owner-only affordances
 * render as false by default.
 */

export interface RoomSummaryInput {
  id: number;
  name: string;
  description: string | null;
  ownerId?: number;
  visibility?: 'public' | 'private';
}

export interface RoomMemberInput {
  userId: number;
  username: string;
  role?: ManageRoomRole | string;
}

export interface CurrentUserInput {
  id: number;
  username: string;
  role: ManageRoomRole;
}

export interface ManageRoomModalProps {
  room: ManageRoomRoom;
  members: ManageRoomMember[];
  currentUser: ManageRoomCurrentUser | null;
}

export function normaliseRole(role: RoomMemberInput['role']): ManageRoomRole {
  return role === 'owner' || role === 'admin' ? role : 'member';
}

/**
 * Convert the room-join ack + presence lookup into the extended
 * `ManageRoomModal` prop shape.
 *
 * Ownership fallback: `room.ownerId ?? members.find(owner-role).userId ?? null`.
 * Never `0`.
 */
export function toManageRoomProps(
  room: RoomSummaryInput,
  members: readonly RoomMemberInput[],
  selfMember: CurrentUserInput | null,
  presenceFor: (userId: number) => PresenceStatus,
): ManageRoomModalProps {
  const ownerFromRole = members.find((m) => normaliseRole(m.role) === 'owner');
  const ownerId: number | null = room.ownerId ?? ownerFromRole?.userId ?? null;

  const modalRoom: ManageRoomRoom = {
    id: room.id,
    name: room.name,
    description: room.description,
    ownerId,
    visibility: room.visibility ?? 'public',
  };

  const modalMembers: ManageRoomMember[] = members.map((m) => ({
    userId: m.userId,
    username: m.username,
    role: normaliseRole(m.role),
    presence: presenceFor(m.userId),
  }));

  const currentUser: ManageRoomCurrentUser | null = selfMember
    ? {
        id: selfMember.id,
        username: selfMember.username,
        role: selfMember.role,
      }
    : null;

  return {
    room: modalRoom,
    members: modalMembers,
    currentUser,
  };
}
