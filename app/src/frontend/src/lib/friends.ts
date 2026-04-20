import { apiFetch } from './api-client';

/**
 * Friends API client.
 *
 * Endpoint shape matches the BFF friends controller spec — see
 * `mng/specs/09-friends.md`. Types kept narrow on purpose so components can
 * light up pending-request UIs without pulling extra fields.
 */

export interface FriendSummary {
  userId: number;
  username: string;
}

export interface IncomingFriendRequest {
  id: number;
  from: FriendSummary;
}

export interface OutgoingFriendRequest {
  id: number;
  to: FriendSummary;
}

export interface FriendsResponse {
  friends: FriendSummary[];
  incoming: IncomingFriendRequest[];
  outgoing: OutgoingFriendRequest[];
}

/** Full friends snapshot — accepted friends + pending requests in both directions. */
export const listFriends = (): Promise<FriendsResponse> =>
  apiFetch<FriendsResponse>('/api/v1/friends');

/** Send a friend request by username. Resolves on 2xx; throws `ApiError` otherwise. */
export const sendFriendRequest = (username: string): Promise<{ id: number }> =>
  apiFetch<{ id: number }>('/api/v1/friends/requests', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });

/** Accept an incoming friend request by its id. */
export const acceptRequest = (id: number): Promise<void> =>
  apiFetch<void>(`/api/v1/friends/requests/${id}/accept`, { method: 'POST' });

/** Reject an incoming friend request by its id. */
export const rejectRequest = (id: number): Promise<void> =>
  apiFetch<void>(`/api/v1/friends/requests/${id}/reject`, { method: 'POST' });

/** Remove an already-accepted friend by their user id. */
export const removeFriend = (userId: number): Promise<void> =>
  apiFetch<void>(`/api/v1/friends/${userId}`, { method: 'DELETE' });
