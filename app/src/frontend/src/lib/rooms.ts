import { apiFetch } from './api-client';

/**
 * Public-catalog shape of a room — only fields the BFF exposes on
 * `GET /api/v1/rooms/catalog`. Keep narrow on purpose: private-room fields,
 * owner identity, and membership metadata are not included here.
 */
export interface CatalogRoom {
  id: number;
  name: string;
  description: string | null;
  memberCount: number;
}

export interface RoomsCatalogResponse {
  rooms: CatalogRoom[];
  total: number;
}

/**
 * Fetch the public rooms catalog. See spec 05-rooms (AC-05-03).
 *
 * BFF endpoint: `GET /api/v1/rooms/catalog`.
 * The endpoint also accepts `q`/`offset`/`limit` — M1 sends none of them; the
 * call signature stays parameter-less until search + pagination are wired.
 */
export const listCatalog = (): Promise<RoomsCatalogResponse> =>
  apiFetch<RoomsCatalogResponse>('/api/v1/rooms/catalog');

/**
 * Idempotent join — POSTs `/api/v1/rooms/:id/join`. Backend returns 204 when
 * the row was inserted AND when the caller was already a member, so the
 * caller can fire-and-forget on every catalog navigation (auto-join).
 *
 * Used by the room route to recover from a `room.join` WS ack of
 * "not a member" — we POST, then re-emit the WS join.
 */
export const joinRoom = (roomId: number): Promise<void> =>
  apiFetch<void>(`/api/v1/rooms/${roomId}/join`, { method: 'POST' });

/** Leave a room (self-removal). 204 on success. Owner can't leave per
 *  AC-05-09 — backend rejects with 403 + must `DELETE /rooms/:id` instead. */
export const leaveRoom = (roomId: number): Promise<void> =>
  apiFetch<void>(`/api/v1/rooms/${roomId}/leave`, { method: 'POST' });
