import { apiFetch } from './api-client';

/**
 * User-directed actions (block / unblock / report).
 *
 * Endpoints match the BFF moderation + ban controllers — see
 * `mng/specs/04-contacts-friends.md` AC-04-15 and `mng/specs/06-moderation.md`.
 * Kept separate from `lib/friends.ts` because these are moderation-flavoured
 * actions, not friend-graph mutations.
 */

export interface ReportUserInput {
  /** Report target kind. MVP exposes only `'user'` via the UserPopover. */
  targetType: 'user' | 'message' | 'room';
  /** Numeric id of the target entity. */
  targetId: number;
  /** Free-form reason, ≤ 500 chars by BFF validation. */
  reason: string;
}

/** Block a user. Removes any existing friendship + freezes shared DM. */
export const blockUser = (userId: number): Promise<void> =>
  apiFetch<void>(`/api/v1/users/${userId}/ban`, { method: 'POST' });

/** Lift a previously-issued user block. */
export const unblockUser = (userId: number): Promise<void> =>
  apiFetch<void>(`/api/v1/users/${userId}/ban`, { method: 'DELETE' });

/** File a moderation report. Returns the new report id on success. */
export const reportUser = (input: ReportUserInput): Promise<{ id: number }> =>
  apiFetch<{ id: number }>('/api/v1/reports', {
    method: 'POST',
    body: JSON.stringify(input),
  });
