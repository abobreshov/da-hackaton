import { apiFetch } from './api-client';

/** Per-scope unread count returned by GET /unread. */
export interface RoomUnreadDto {
  roomId: number;
  count: number;
}

export interface DmUnreadDto {
  dmId: number;
  /** User id of the other side of this DM from the caller's perspective. */
  peerUserId: number;
  count: number;
}

export interface UnreadCountsDto {
  rooms: RoomUnreadDto[];
  dms: DmUnreadDto[];
}

/** Fetches the current user's unread counts across rooms + DMs. */
export function getUnreadCounts(): Promise<UnreadCountsDto> {
  return apiFetch<UnreadCountsDto>('/api/v1/unread');
}

/**
 * Marks a room read up to `lastReadId`. `lastReadId` is a bigint message id
 * encoded as a decimal string (messages ids are `bigint` on the backend).
 *
 * Returns 204 — this function resolves to `void`.
 */
export async function markRoomRead(roomId: number, lastReadId: string): Promise<void> {
  await apiFetch(`/api/v1/rooms/${roomId}/read`, {
    method: 'POST',
    body: JSON.stringify({ lastReadId }),
  });
}

/**
 * Marks a DM read up to `lastReadId`. First argument is the peer user id
 * (matches the route in `/dms/:userId`); the backend resolves that to an
 * internal dm_id and treats "no DM exchanged yet" as a no-op.
 */
export async function markDmRead(peerUserId: number, lastReadId: string): Promise<void> {
  await apiFetch(`/api/v1/dms/${peerUserId}/read`, {
    method: 'POST',
    body: JSON.stringify({ lastReadId }),
  });
}
