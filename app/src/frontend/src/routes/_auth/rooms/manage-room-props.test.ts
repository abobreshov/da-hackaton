import { describe, it, expect } from 'vitest';
import { toManageRoomProps } from './manage-room-props';
import type { PresenceStatus } from '@/hooks/usePresenceMap';

/**
 * Pure helper — no DOM, no hooks, no socket. Converts the room-join ack
 * shape into the extended `ManageRoomModal` prop shape.
 *
 * Regression-critical piece: the `ownerId` fallback must return `null` when
 * the room has no `ownerId` AND nobody in the members list carries the
 * `'owner'` role — a numeric `0` ownerId would trivially falsy-check while
 * still looking like a valid user id to downstream ownership checks.
 */

const presenceFor = (_userId: number): PresenceStatus => 'offline';

describe('toManageRoomProps', () => {
  it('passes through room.ownerId when present', () => {
    const out = toManageRoomProps(
      {
        id: 42,
        name: 'general',
        description: null,
        ownerId: 7,
        visibility: 'public',
      },
      [
        { userId: 7, username: 'alice', role: 'owner' },
        { userId: 8, username: 'bob', role: 'member' },
      ],
      { id: 8, username: 'bob', role: 'member' },
      presenceFor,
    );
    expect(out.room.ownerId).toBe(7);
    expect(out.room.id).toBe(42);
    expect(out.room.name).toBe('general');
    expect(out.room.visibility).toBe('public');
  });

  it('falls back to the member flagged with role=owner when room.ownerId is missing', () => {
    const out = toManageRoomProps(
      {
        id: 42,
        name: 'general',
        description: null,
      },
      [
        { userId: 11, username: 'alice', role: 'owner' },
        { userId: 12, username: 'bob', role: 'member' },
      ],
      { id: 12, username: 'bob', role: 'member' },
      presenceFor,
    );
    expect(out.room.ownerId).toBe(11);
  });

  it('returns null ownerId (NOT 0) when no ownerId and no owner-role member exists (CR N7)', () => {
    const out = toManageRoomProps(
      {
        id: 42,
        name: 'general',
        description: null,
      },
      [
        { userId: 12, username: 'bob', role: 'member' },
        { userId: 13, username: 'chris', role: 'admin' },
      ],
      { id: 12, username: 'bob', role: 'member' },
      presenceFor,
    );
    expect(out.room.ownerId).toBeNull();
  });

  it('defaults visibility to "public" when the room summary omits it', () => {
    const out = toManageRoomProps(
      { id: 1, name: 'x', description: null, ownerId: 1 },
      [{ userId: 1, username: 'alice', role: 'owner' }],
      { id: 1, username: 'alice', role: 'owner' },
      presenceFor,
    );
    expect(out.room.visibility).toBe('public');
  });

  it('respects explicit visibility="private"', () => {
    const out = toManageRoomProps(
      { id: 1, name: 'x', description: null, ownerId: 1, visibility: 'private' },
      [{ userId: 1, username: 'alice', role: 'owner' }],
      { id: 1, username: 'alice', role: 'owner' },
      presenceFor,
    );
    expect(out.room.visibility).toBe('private');
  });

  it('projects each member to ManageRoomMember with presence + normalised role', () => {
    const presence = (userId: number): PresenceStatus =>
      userId === 1 ? 'online' : userId === 2 ? 'afk' : 'offline';
    const out = toManageRoomProps(
      { id: 1, name: 'x', description: null, ownerId: 1 },
      [
        { userId: 1, username: 'alice', role: 'owner' },
        { userId: 2, username: 'bob', role: 'admin' },
        { userId: 3, username: 'chris' }, // no role → member
        { userId: 4, username: 'dee', role: 'weird-unknown' }, // unknown → member
      ],
      { id: 1, username: 'alice', role: 'owner' },
      presence,
    );
    expect(out.members).toEqual([
      { userId: 1, username: 'alice', role: 'owner', presence: 'online' },
      { userId: 2, username: 'bob', role: 'admin', presence: 'afk' },
      { userId: 3, username: 'chris', role: 'member', presence: 'offline' },
      { userId: 4, username: 'dee', role: 'member', presence: 'offline' },
    ]);
  });

  it('projects currentUser when both currentUserId + selfMember are given', () => {
    const out = toManageRoomProps(
      { id: 1, name: 'x', description: null, ownerId: 1 },
      [
        { userId: 1, username: 'alice', role: 'owner' },
        { userId: 2, username: 'bob', role: 'member' },
      ],
      { id: 2, username: 'bob', role: 'member' },
      presenceFor,
    );
    expect(out.currentUser).toEqual({
      id: 2,
      username: 'bob',
      role: 'member',
    });
  });

  it('returns currentUser=null when selfMember is null (user not in the room)', () => {
    const out = toManageRoomProps(
      { id: 1, name: 'x', description: null, ownerId: 1 },
      [{ userId: 1, username: 'alice', role: 'owner' }],
      null,
      presenceFor,
    );
    expect(out.currentUser).toBeNull();
  });
});
