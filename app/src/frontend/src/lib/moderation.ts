import { apiFetch } from './api-client';

/**
 * Moderation + room-settings API client.
 *
 * Thin wrappers over the BFF endpoints defined in `mng/specs/06-moderation.md`
 * and `mng/specs/05-rooms.md`. No business logic — caller is responsible for
 * role gating at the UI level; the BFF enforces role on the server side.
 */

/** Entry in the `GET /rooms/:id/bans` response. */
export interface RoomBan {
  userId: number;
  username: string;
  bannedBy: number;
  bannedByUsername: string;
  createdAt: string;
}

export interface RoomBansResponse {
  bans: RoomBan[];
}

export type RoomVisibility = 'public' | 'private';

/** Body for `PATCH /rooms/:id`. All fields optional — only supplied keys change. */
export interface RoomPatch {
  name?: string;
  description?: string | null;
  visibility?: RoomVisibility;
}

/** Canonical "room after patch" shape returned by `updateRoom`. */
export interface RoomRecord {
  id: number;
  name: string;
  description: string | null;
  visibility: RoomVisibility;
  memberCount: number;
}

/** Owner-only: promote a plain member to admin. */
export const promoteMember = (roomId: number, userId: number): Promise<void> =>
  apiFetch<void>(`/api/v1/rooms/${roomId}/members/${userId}/promote`, {
    method: 'POST',
  });

/** Admin+: demote an admin to plain member. Owner cannot self-demote (BFF 403). */
export const demoteMember = (roomId: number, userId: number): Promise<void> =>
  apiFetch<void>(`/api/v1/rooms/${roomId}/members/${userId}/demote`, {
    method: 'POST',
  });

/**
 * Admin+: remove a member from the room. Per AC-06-05 this is equivalent to
 * a ban (banned user cannot rejoin unless unbanned).
 */
export const removeMember = (roomId: number, userId: number): Promise<void> =>
  apiFetch<void>(`/api/v1/rooms/${roomId}/members/${userId}`, {
    method: 'DELETE',
  });

/** Admin+: unban a previously banned user. */
export const unbanMember = (roomId: number, userId: number): Promise<void> =>
  apiFetch<void>(`/api/v1/rooms/${roomId}/bans/${userId}/unban`, {
    method: 'POST',
  });

/** Admin+: list bans for a room. Drives the Banned tab of ManageRoomModal. */
export const listRoomBans = (roomId: number): Promise<RoomBansResponse> =>
  apiFetch<RoomBansResponse>(`/api/v1/rooms/${roomId}/bans`);

/** Owner-only: soft-delete the room. Cascades messages + attachments server-side. */
export const deleteRoom = (roomId: number): Promise<void> =>
  apiFetch<void>(`/api/v1/rooms/${roomId}`, { method: 'DELETE' });

/** Owner-only: patch room metadata. UNIQUE on name → 409 surfaces as ApiError. */
export const updateRoom = (roomId: number, patch: RoomPatch): Promise<RoomRecord> =>
  apiFetch<RoomRecord>(`/api/v1/rooms/${roomId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

/**
 * Response shape from `POST /rooms/:id/invitations`.
 *
 * Per ADR-005 (fail-silent username resolution) the BFF always returns
 * `{ queued: true, invited: number | null }` regardless of whether the
 * username matched an existing user. `invited` is the resolved user id when
 * known, or `null` when no such user exists. Callers MUST NOT branch UI on
 * `invited === null` — leaking that distinction would expose username
 * existence. Treat the call as success whenever it resolves without throwing.
 */
export interface InviteUserResponse {
  queued: true;
  invited: number | null;
}

/**
 * Member+: invite another user to a (private) room by username.
 *
 * BFF's `InviteUserDto` now accepts either `{ username }` or
 * `{ invitedUserId }`; the FE uniformly sends `{ username }` so components
 * don't have to pre-resolve ids. Resolution happens in BFF `RoomsService`
 * via `UsersService.resolveUserIdByUsername` before the backend RPC.
 */
export const inviteUser = (roomId: number, username: string): Promise<InviteUserResponse> =>
  apiFetch<InviteUserResponse>(`/api/v1/rooms/${roomId}/invitations`, {
    method: 'POST',
    body: JSON.stringify({ username }),
  });
