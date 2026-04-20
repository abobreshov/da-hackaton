/**
 * Unit tests for RoomsService (EPIC-05).
 *
 * The service delegates Drizzle calls to a thin `RoomsRepository`; this spec
 * drives a fully in-memory fake repository so we exercise the service's
 * business rules (visibility checks, owner-cannot-leave, admin-only invites,
 * unique-name conflict translation) without needing Postgres.
 *
 * Integration tests cover the real Drizzle query behaviour separately.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import type {
  CreateRoomInput,
  InsertInvitationInput,
  InsertMembershipInput,
  RoomRow,
  MembershipRow,
  InvitationRow,
  RoomsRepositoryPort,
  MemberWithUsername,
} from './rooms.types';

/**
 * In-memory repository mirroring the contract the service talks to.
 * Keeps three arrays + monotonic IDs; enforces the domain-relevant unique
 * constraints so conflict paths are testable.
 */
class FakeRoomsRepository implements RoomsRepositoryPort {
  rooms: RoomRow[] = [];
  memberships: MembershipRow[] = [];
  invitations: InvitationRow[] = [];
  /** Minimal users mirror for `findMembersWithUsernames` join. */
  users: Array<{ id: number; username: string }> = [];
  private nextRoomId = 1;
  private nextInvId = 1;

  async insertRoom(input: CreateRoomInput): Promise<RoomRow> {
    if (this.rooms.some((r) => r.name === input.name && r.deletedAt == null)) {
      const err: any = new Error('duplicate key value violates unique constraint');
      err.code = '23505';
      throw err;
    }
    const row: RoomRow = {
      id: this.nextRoomId++,
      name: input.name,
      description: input.description ?? null,
      visibility: input.visibility,
      ownerId: input.ownerId,
      createdAt: new Date(),
      deletedAt: null,
    };
    this.rooms.push(row);
    return row;
  }

  async findRoomById(id: number): Promise<RoomRow | null> {
    return this.rooms.find((r) => r.id === id && r.deletedAt == null) ?? null;
  }

  async listPublicRooms(): Promise<RoomRow[]> {
    return this.rooms
      .filter((r) => r.visibility === 'public' && r.deletedAt == null)
      .map((r) => ({ ...r }));
  }

  async listRoomsForUser(userId: number): Promise<RoomRow[]> {
    const roomIds = new Set(
      this.memberships.filter((m) => m.userId === userId).map((m) => m.roomId),
    );
    return this.rooms
      .filter((r) => roomIds.has(r.id) && r.deletedAt == null)
      .map((r) => ({ ...r }));
  }

  async insertMembership(input: InsertMembershipInput): Promise<MembershipRow> {
    if (this.memberships.some((m) => m.roomId === input.roomId && m.userId === input.userId)) {
      const err: any = new Error('duplicate key value violates unique constraint');
      err.code = '23505';
      throw err;
    }
    const row: MembershipRow = {
      roomId: input.roomId,
      userId: input.userId,
      role: input.role,
      joinedAt: new Date(),
    };
    this.memberships.push(row);
    return row;
  }

  async findMembership(roomId: number, userId: number): Promise<MembershipRow | null> {
    return this.memberships.find((m) => m.roomId === roomId && m.userId === userId) ?? null;
  }

  async deleteMembership(roomId: number, userId: number): Promise<number> {
    const before = this.memberships.length;
    this.memberships = this.memberships.filter(
      (m) => !(m.roomId === roomId && m.userId === userId),
    );
    return before - this.memberships.length;
  }

  async findPendingInvitation(roomId: number, inviteeId: number): Promise<InvitationRow | null> {
    return (
      this.invitations.find(
        (i) =>
          i.roomId === roomId &&
          i.inviteeId === inviteeId &&
          i.acceptedAt == null &&
          i.rejectedAt == null,
      ) ?? null
    );
  }

  async insertInvitation(input: InsertInvitationInput): Promise<InvitationRow> {
    if (
      this.invitations.some((i) => i.roomId === input.roomId && i.inviteeId === input.inviteeId)
    ) {
      const err: any = new Error('duplicate key value violates unique constraint');
      err.code = '23505';
      throw err;
    }
    const row: InvitationRow = {
      id: this.nextInvId++,
      roomId: input.roomId,
      inviterId: input.inviterId,
      inviteeId: input.inviteeId,
      createdAt: new Date(),
      acceptedAt: null,
      rejectedAt: null,
    };
    this.invitations.push(row);
    return row;
  }

  async findMembersWithUsernames(roomId: number): Promise<MemberWithUsername[]> {
    return this.memberships
      .filter((m) => m.roomId === roomId)
      .map((m) => {
        const user = this.users.find((u) => u.id === m.userId);
        return {
          userId: m.userId,
          role: m.role,
          username: user?.username ?? `user-${m.userId}`,
        };
      });
  }

  async updateRoom(
    id: number,
    patch: {
      name?: string;
      description?: string | null;
      visibility?: 'public' | 'private';
    },
  ): Promise<RoomRow | null> {
    const row = this.rooms.find((r) => r.id === id && r.deletedAt == null);
    if (!row) return null;
    if (patch.name !== undefined) {
      const clash = this.rooms.find(
        (r) => r.id !== id && r.name === patch.name && r.deletedAt == null,
      );
      if (clash) {
        const err: any = new Error('duplicate key value violates unique constraint');
        err.code = '23505';
        throw err;
      }
      row.name = patch.name;
    }
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.visibility !== undefined) row.visibility = patch.visibility;
    return { ...row };
  }
}

const OWNER = 1;
const MEMBER = 2;
const OUTSIDER = 3;

describe('RoomsService', () => {
  let repo: FakeRoomsRepository;
  let service: RoomsService;

  beforeEach(() => {
    repo = new FakeRoomsRepository();
    service = new RoomsService(repo);
  });

  describe('create', () => {
    it('creates a public room and makes owner an owner-role member', async () => {
      const room = await service.create({
        ownerId: OWNER,
        name: 'general',
        visibility: 'public',
        description: 'General chat',
      });

      expect(room).toMatchObject({
        id: 1,
        name: 'general',
        visibility: 'public',
        ownerId: OWNER,
      });
      expect(repo.rooms).toHaveLength(1);
      expect(repo.memberships).toEqual([
        expect.objectContaining({ roomId: 1, userId: OWNER, role: 'owner' }),
      ]);
    });

    it('creates a private room', async () => {
      const room = await service.create({
        ownerId: OWNER,
        name: 'secrets',
        visibility: 'private',
      });
      expect(room.visibility).toBe('private');
    });

    it('rejects invalid visibility values', async () => {
      await expect(
        service.create({
          ownerId: OWNER,
          name: 'bad',
          // @ts-expect-error deliberately invalid
          visibility: 'hybrid',
        }),
      ).rejects.toThrow();
    });

    it('throws ConflictException on duplicate name (AC-05-02)', async () => {
      await service.create({ ownerId: OWNER, name: 'dup', visibility: 'public' });
      await expect(
        service.create({ ownerId: MEMBER, name: 'dup', visibility: 'public' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects empty / whitespace-only name with BadRequestException (line 55-57)', async () => {
      await expect(
        service.create({ ownerId: OWNER, name: '', visibility: 'public' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({ ownerId: OWNER, name: '   ', visibility: 'public' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('re-throws non-unique DB errors from insertRoom (line 71)', async () => {
      const brokenRepo: any = {
        insertRoom: jest.fn().mockRejectedValue(new Error('connection refused')),
        insertMembership: jest.fn(),
      };
      const svc = new RoomsService(brokenRepo);
      await expect(svc.create({ ownerId: OWNER, name: 'x', visibility: 'public' })).rejects.toThrow(
        'connection refused',
      );
      expect(brokenRepo.insertMembership).not.toHaveBeenCalled();
    });
  });

  describe('catalog', () => {
    it('lists only public, non-deleted rooms (AC-05-03, AC-05-05)', async () => {
      await service.create({ ownerId: OWNER, name: 'public-a', visibility: 'public' });
      await service.create({ ownerId: OWNER, name: 'public-b', visibility: 'public' });
      await service.create({ ownerId: OWNER, name: 'hidden', visibility: 'private' });

      // Soft-delete public-b
      const deletedRoom = repo.rooms.find((r) => r.name === 'public-b')!;
      deletedRoom.deletedAt = new Date();

      const list = await service.catalog();
      expect(list.map((r) => r.name).sort()).toEqual(['public-a']);
    });

    it('returns an empty list when no public rooms exist', async () => {
      await service.create({ ownerId: OWNER, name: 'only-private', visibility: 'private' });
      expect(await service.catalog()).toEqual([]);
    });
  });

  describe('listMy', () => {
    it('returns rooms where the user is a member', async () => {
      await service.create({ ownerId: OWNER, name: 'r1', visibility: 'public' });
      await service.create({ ownerId: OWNER, name: 'r2', visibility: 'public' });
      const r3 = await service.create({ ownerId: OWNER, name: 'r3', visibility: 'public' });
      await service.join({ userId: MEMBER, roomId: r3.id });

      const ownerRooms = await service.listMy(OWNER);
      const memberRooms = await service.listMy(MEMBER);
      const outsiderRooms = await service.listMy(OUTSIDER);

      expect(ownerRooms.map((r) => r.name).sort()).toEqual(['r1', 'r2', 'r3']);
      expect(memberRooms.map((r) => r.name)).toEqual(['r3']);
      expect(outsiderRooms).toEqual([]);
    });
  });

  describe('join', () => {
    it('allows a user to join a public room (AC-05-06)', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'lounge', visibility: 'public' });
      await service.join({ userId: MEMBER, roomId: r.id });
      expect(
        repo.memberships
          .filter((m) => m.roomId === r.id)
          .map((m) => m.userId)
          .sort(),
      ).toEqual([OWNER, MEMBER].sort());
    });

    it('denies joining a private room without invitation (AC-05-05)', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'club', visibility: 'private' });
      await expect(service.join({ userId: OUTSIDER, roomId: r.id })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('allows joining a private room when a pending invitation exists', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'club2', visibility: 'private' });
      await service.invite({ inviterId: OWNER, inviteeId: MEMBER, roomId: r.id });
      await service.join({ userId: MEMBER, roomId: r.id });
      expect(repo.memberships.find((m) => m.roomId === r.id && m.userId === MEMBER)).toBeDefined();
    });

    it('throws NotFoundException when room does not exist', async () => {
      await expect(service.join({ userId: MEMBER, roomId: 999 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('short-circuits when user is already a member (returns existing row)', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'loungex', visibility: 'public' });
      await service.join({ userId: MEMBER, roomId: r.id });
      // Second call hits the "existing membership" branch: no new insert.
      const before = repo.memberships.length;
      const out = await service.join({ userId: MEMBER, roomId: r.id });
      expect(out).toBeDefined();
      expect(repo.memberships.length).toBe(before);
    });

    it('rejects room with non-public/non-private visibility (line 105-106)', async () => {
      // Inject a room row with an impossible visibility to exercise the else branch.
      repo.rooms.push({
        id: 999,
        name: 'weird',
        description: null,
        visibility: 'hybrid' as any,
        ownerId: OWNER,
        createdAt: new Date(),
        deletedAt: null,
      });
      await expect(service.join({ userId: MEMBER, roomId: 999 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('treats racy double-join unique violation as success (lines 116-121)', async () => {
      const room = await service.create({ ownerId: OWNER, name: 'race', visibility: 'public' });
      // Simulate: findMembership says "no", then insertMembership throws 23505,
      // then re-findMembership returns a row (because another worker inserted).
      const fakeRepo: any = {
        findRoomById: jest.fn().mockResolvedValue(room),
        findMembership: jest
          .fn()
          .mockResolvedValueOnce(null) // first probe
          .mockResolvedValueOnce({
            roomId: room.id,
            userId: MEMBER,
            role: 'member',
            joinedAt: new Date(),
          }), // after 23505
        insertMembership: jest.fn(() => {
          const err: any = new Error('duplicate');
          err.code = '23505';
          return Promise.reject(err);
        }),
        findPendingInvitation: jest.fn(),
        listPublicRooms: jest.fn(),
        listRoomsForUser: jest.fn(),
        insertRoom: jest.fn(),
        deleteMembership: jest.fn(),
        insertInvitation: jest.fn(),
      };
      const svc = new RoomsService(fakeRepo);
      const row = await svc.join({ userId: MEMBER, roomId: room.id });
      expect(row).toMatchObject({ roomId: room.id, userId: MEMBER, role: 'member' });
    });

    it('re-throws a unique violation when the re-probe still finds no row', async () => {
      const room = await service.create({ ownerId: OWNER, name: 'race2', visibility: 'public' });
      const fakeRepo: any = {
        findRoomById: jest.fn().mockResolvedValue(room),
        findMembership: jest.fn().mockResolvedValue(null),
        insertMembership: jest.fn(() => {
          const err: any = new Error('duplicate');
          err.code = '23505';
          return Promise.reject(err);
        }),
        findPendingInvitation: jest.fn(),
        listPublicRooms: jest.fn(),
        listRoomsForUser: jest.fn(),
        insertRoom: jest.fn(),
        deleteMembership: jest.fn(),
        insertInvitation: jest.fn(),
      };
      const svc = new RoomsService(fakeRepo);
      await expect(svc.join({ userId: MEMBER, roomId: room.id })).rejects.toThrow('duplicate');
    });

    it('re-throws non-unique DB errors from insertMembership (line 121)', async () => {
      const room = await service.create({ ownerId: OWNER, name: 'race3', visibility: 'public' });
      const fakeRepo: any = {
        findRoomById: jest.fn().mockResolvedValue(room),
        findMembership: jest.fn().mockResolvedValue(null),
        insertMembership: jest.fn().mockRejectedValue(new Error('disk full')),
        findPendingInvitation: jest.fn(),
        listPublicRooms: jest.fn(),
        listRoomsForUser: jest.fn(),
        insertRoom: jest.fn(),
        deleteMembership: jest.fn(),
        insertInvitation: jest.fn(),
      };
      const svc = new RoomsService(fakeRepo);
      await expect(svc.join({ userId: MEMBER, roomId: room.id })).rejects.toThrow('disk full');
    });
  });

  describe('leave', () => {
    it('removes the membership row (AC-05-07)', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'x', visibility: 'public' });
      await service.join({ userId: MEMBER, roomId: r.id });
      await service.leave({ userId: MEMBER, roomId: r.id });
      expect(
        repo.memberships.find((m) => m.roomId === r.id && m.userId === MEMBER),
      ).toBeUndefined();
    });

    it('forbids the owner from leaving their own room (AC-05-08)', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'mine', visibility: 'public' });
      await expect(service.leave({ userId: OWNER, roomId: r.id })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws NotFoundException if user is not a member', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'x2', visibility: 'public' });
      await expect(service.leave({ userId: OUTSIDER, roomId: r.id })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('invite', () => {
    it('lets an owner invite someone (AC-05-11)', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'inv', visibility: 'private' });
      const inv = await service.invite({ inviterId: OWNER, inviteeId: MEMBER, roomId: r.id });
      expect(inv).toMatchObject({ roomId: r.id, inviterId: OWNER, inviteeId: MEMBER });
      expect(repo.invitations).toHaveLength(1);
    });

    it('rejects invites from non-admin/non-owner members', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'inv2', visibility: 'private' });
      // Simulate MEMBER already joined as 'member'
      await repo.insertMembership({ roomId: r.id, userId: MEMBER, role: 'member' });

      await expect(
        service.invite({ inviterId: MEMBER, inviteeId: OUTSIDER, roomId: r.id }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects duplicate invitations', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'inv3', visibility: 'private' });
      await service.invite({ inviterId: OWNER, inviteeId: MEMBER, roomId: r.id });
      await expect(
        service.invite({ inviterId: OWNER, inviteeId: MEMBER, roomId: r.id }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException for missing room', async () => {
      await expect(
        service.invite({ inviterId: OWNER, inviteeId: MEMBER, roomId: 999 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects self-invite with BadRequestException (line 144-145)', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'selfinv', visibility: 'private' });
      await expect(
        service.invite({ inviterId: OWNER, inviteeId: OWNER, roomId: r.id }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('re-throws non-unique DB errors from insertInvitation (lines 158-161)', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'invx', visibility: 'private' });
      // Owner membership exists from create(); override just insertInvitation.
      const original = repo.insertInvitation.bind(repo);
      repo.insertInvitation = jest.fn().mockRejectedValue(new Error('fk violation'));
      await expect(
        service.invite({ inviterId: OWNER, inviteeId: MEMBER, roomId: r.id }),
      ).rejects.toThrow('fk violation');
      repo.insertInvitation = original;
    });

    it('forbids invite when inviter has no membership row at all', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'priv-only', visibility: 'private' });
      // MEMBER is not a member of r; they cannot invite.
      await expect(
        service.invite({ inviterId: MEMBER, inviteeId: OUTSIDER, roomId: r.id }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('membersOf (EPIC-03 AC-03-09, EPIC-15 AC-15-13)', () => {
    it('returns members joined with usernames', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'hall', visibility: 'public' });
      await service.join({ userId: MEMBER, roomId: r.id });
      repo.users.push({ id: OWNER, username: 'alice' }, { id: MEMBER, username: 'bob' });

      const out = await service.membersOf(r.id);

      expect(out).toEqual({
        members: expect.arrayContaining([
          { userId: OWNER, role: 'owner', username: 'alice' },
          { userId: MEMBER, role: 'member', username: 'bob' },
        ]),
      });
      expect(out.members).toHaveLength(2);
    });

    it('throws NotFoundException when room is deleted (soft-delete)', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'gone', visibility: 'public' });
      const row = repo.rooms.find((rr) => rr.id === r.id)!;
      row.deletedAt = new Date();
      await expect(service.membersOf(r.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when room does not exist', async () => {
      await expect(service.membersOf(9999)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('ensureMember (EPIC-15 AC-15-13)', () => {
    it('returns { ok: true } when user is a member', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'ok', visibility: 'public' });
      await service.join({ userId: MEMBER, roomId: r.id });

      await expect(service.ensureMember({ roomId: r.id, userId: MEMBER })).resolves.toEqual({
        ok: true,
      });
    });

    it('returns { ok: true } for the owner', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'ok2', visibility: 'public' });
      await expect(service.ensureMember({ roomId: r.id, userId: OWNER })).resolves.toEqual({
        ok: true,
      });
    });

    it('throws ForbiddenException when user is not a member (FORBIDDEN WireError)', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'locked', visibility: 'public' });
      await expect(service.ensureMember({ roomId: r.id, userId: OUTSIDER })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when room is deleted (NOT_FOUND WireError)', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'dead', visibility: 'public' });
      const row = repo.rooms.find((rr) => rr.id === r.id)!;
      row.deletedAt = new Date();
      await expect(service.ensureMember({ roomId: r.id, userId: OWNER })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException when room does not exist', async () => {
      await expect(service.ensureMember({ roomId: 9999, userId: OWNER })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update (EPIC-05 AC-05-13 — owner PATCH)', () => {
    it('updates name/description/visibility when actor is the owner', async () => {
      const r = await service.create({
        ownerId: OWNER,
        name: 'orig-name',
        visibility: 'public',
        description: 'old',
      });
      const updated = await service.update({
        roomId: r.id,
        actorId: OWNER,
        patch: { name: 'new-name', description: 'fresh', visibility: 'private' },
      });
      expect(updated).toMatchObject({
        id: r.id,
        name: 'new-name',
        description: 'fresh',
        visibility: 'private',
      });
    });

    it('visibility flip public -> private is allowed for owner', async () => {
      const r = await service.create({
        ownerId: OWNER,
        name: 'flip',
        visibility: 'public',
      });
      const updated = await service.update({
        roomId: r.id,
        actorId: OWNER,
        patch: { visibility: 'private' },
      });
      expect(updated.visibility).toBe('private');
    });

    it('rejects non-owner actor with ForbiddenException', async () => {
      const r = await service.create({
        ownerId: OWNER,
        name: 'private-club',
        visibility: 'public',
      });
      // MEMBER joins; they're still not the owner.
      await service.join({ userId: MEMBER, roomId: r.id });
      await expect(
        service.update({
          roomId: r.id,
          actorId: MEMBER,
          patch: { name: 'hijacked' },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects admin (non-owner) — update is owner-only', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'admin-test', visibility: 'public' });
      // Promote MEMBER to admin via repo (service lacks promote here; fake it).
      await repo.insertMembership({ roomId: r.id, userId: MEMBER, role: 'admin' });
      await expect(
        service.update({
          roomId: r.id,
          actorId: MEMBER,
          patch: { name: 'nope' },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ConflictException on duplicate name (409)', async () => {
      await service.create({ ownerId: OWNER, name: 'taken', visibility: 'public' });
      const mine = await service.create({ ownerId: OWNER, name: 'mine', visibility: 'public' });
      await expect(
        service.update({
          roomId: mine.id,
          actorId: OWNER,
          patch: { name: 'taken' },
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException for missing room', async () => {
      await expect(
        service.update({
          roomId: 9999,
          actorId: OWNER,
          patch: { name: 'x' },
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for soft-deleted room', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'gone', visibility: 'public' });
      repo.rooms.find((rr) => rr.id === r.id)!.deletedAt = new Date();
      await expect(
        service.update({
          roomId: r.id,
          actorId: OWNER,
          patch: { name: 'x' },
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects invalid visibility', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'bad-vis', visibility: 'public' });
      await expect(
        service.update({
          roomId: r.id,
          actorId: OWNER,
          // @ts-expect-error deliberately invalid
          patch: { visibility: 'hybrid' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects empty name', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'name-test', visibility: 'public' });
      await expect(
        service.update({
          roomId: r.id,
          actorId: OWNER,
          patch: { name: '   ' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('is a no-op when patch is empty (returns current row)', async () => {
      const r = await service.create({ ownerId: OWNER, name: 'noop', visibility: 'public' });
      const updated = await service.update({
        roomId: r.id,
        actorId: OWNER,
        patch: {},
      });
      expect(updated).toMatchObject({ id: r.id, name: 'noop' });
    });
  });
});
