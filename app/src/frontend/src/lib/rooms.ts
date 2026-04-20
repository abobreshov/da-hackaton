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
