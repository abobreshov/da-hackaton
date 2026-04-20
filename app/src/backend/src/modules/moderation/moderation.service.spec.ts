/**
 * Unit tests for ModerationService (EPIC-06).
 *
 * The service depends on `ModerationRepositoryPort` + `IEventPublisher`. The
 * spec drives a fully in-memory fake repository so the business rules
 * (owner / admin / member matrix, idempotent role transitions, conflict
 * mapping) are exercised without Postgres. The publisher is a `jest.fn()`
 * — assertions confirm the service emits the right domain event with the
 * right payload (audit append is an `AuditSubscriber` concern, not the
 * service's).
 */

import {
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { ModerationService } from './moderation.service';
import type {
  BanMemberRepoInput,
  ModerationRepositoryPort,
  Role,
  RoomBanRow,
} from './moderation.types';
import type { IEventPublisher } from '../../common/events/event-publisher.interface';

interface MembershipRow {
  roomId: number;
  userId: number;
  role: Role;
}

class FakeModerationRepository implements ModerationRepositoryPort {
  memberships = new Map<string, MembershipRow>();
  bans = new Map<string, RoomBanRow>();
  rooms = new Map<number, { id: number; deletedAt: Date | null }>();

  static key(roomId: number, userId: number): string {
    return `${roomId}:${userId}`;
  }

  async roleOf(roomId: number, userId: number): Promise<Role | null> {
    return this.memberships.get(FakeModerationRepository.key(roomId, userId))?.role ?? null;
  }

  async banMember(input: BanMemberRepoInput): Promise<void> {
    const k = FakeModerationRepository.key(input.roomId, input.userId);
    if (this.bans.has(k)) {
      const err: any = new Error('duplicate key value violates unique constraint "room_bans_pkey"');
      err.code = '23505';
      throw err;
    }
    this.bans.set(k, {
      roomId: input.roomId,
      userId: input.userId,
      bannedBy: input.bannedBy,
      bannedAt: new Date(),
    });
    this.memberships.delete(k);
  }

  async unbanMember(roomId: number, userId: number): Promise<void> {
    this.bans.delete(FakeModerationRepository.key(roomId, userId));
  }

  async listBans(roomId: number): Promise<RoomBanRow[]> {
    return [...this.bans.values()].filter((r) => r.roomId === roomId);
  }

  async promoteMember(roomId: number, userId: number): Promise<void> {
    const m = this.memberships.get(FakeModerationRepository.key(roomId, userId));
    if (m) m.role = 'admin';
  }

  async demoteMember(roomId: number, userId: number): Promise<void> {
    const m = this.memberships.get(FakeModerationRepository.key(roomId, userId));
    if (m) m.role = 'member';
  }

  async deleteRoom(roomId: number, deletedAt: Date): Promise<void> {
    const r = this.rooms.get(roomId);
    if (r) r.deletedAt = deletedAt;
  }
}

function seed(): FakeModerationRepository {
  const repo = new FakeModerationRepository();
  const seedMembership = (roomId: number, userId: number, role: Role): void => {
    repo.memberships.set(FakeModerationRepository.key(roomId, userId), {
      roomId,
      userId,
      role,
    });
  };
  seedMembership(1, 10, 'owner');
  seedMembership(1, 20, 'admin');
  seedMembership(1, 30, 'member');
  seedMembership(1, 40, 'member');
  repo.rooms.set(1, { id: 1, deletedAt: null });
  return repo;
}

function makeEvents(): jest.Mocked<IEventPublisher> {
  return { emit: jest.fn(), on: jest.fn() } as unknown as jest.Mocked<IEventPublisher>;
}

describe('ModerationService', () => {
  describe('banMember()', () => {
    it('admin bans a member: writes ban + removes membership + emits room.ban', async () => {
      const repo = seed();
      const events = makeEvents();
      const svc = new ModerationService(repo, events);

      await svc.banMember({ roomId: 1, adminId: 20, userId: 30 });

      expect(repo.bans.has(FakeModerationRepository.key(1, 30))).toBe(true);
      expect(repo.memberships.has(FakeModerationRepository.key(1, 30))).toBe(false);
      expect(events.emit).toHaveBeenCalledWith('room.ban', {
        actorId: 20,
        roomId: 1,
        userId: 30,
      });
    });

    it('member cannot ban (FORBIDDEN)', async () => {
      const repo = seed();
      const svc = new ModerationService(repo, makeEvents());

      await expect(
        svc.banMember({ roomId: 1, adminId: 30, userId: 40 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('cannot ban the owner', async () => {
      const repo = seed();
      const svc = new ModerationService(repo, makeEvents());

      await expect(
        svc.banMember({ roomId: 1, adminId: 20, userId: 10 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses to ban a non-member (NOT_FOUND)', async () => {
      const repo = seed();
      const svc = new ModerationService(repo, makeEvents());

      await expect(
        svc.banMember({ roomId: 1, adminId: 20, userId: 99 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('maps repo unique-violation (23505) to wire CONFLICT (409)', async () => {
      const repo = seed();
      repo.bans.set(FakeModerationRepository.key(1, 30), {
        roomId: 1,
        userId: 30,
        bannedBy: 20,
        bannedAt: new Date(),
      });
      const svc = new ModerationService(repo, makeEvents());

      try {
        await svc.banMember({ roomId: 1, adminId: 20, userId: 30 });
        fail('expected HttpException');
      } catch (e: any) {
        expect(e).toBeInstanceOf(HttpException);
        expect(e.getStatus()).toBe(409);
        const body = e.getResponse();
        expect(body).toMatchObject({
          code: expect.any(String),
          message: expect.stringContaining('already banned'),
        });
      }
    });

    it('re-throws non-23505 errors from the repo and does not emit', async () => {
      const repo = seed();
      jest.spyOn(repo, 'banMember').mockRejectedValueOnce(new Error('pg down'));
      const events = makeEvents();
      const svc = new ModerationService(repo, events);

      await expect(
        svc.banMember({ roomId: 1, adminId: 20, userId: 30 }),
      ).rejects.toThrow('pg down');
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('unbanMember()', () => {
    it('admin unbans a previously banned user + emits room.unban', async () => {
      const repo = seed();
      repo.bans.set(FakeModerationRepository.key(1, 30), {
        roomId: 1,
        userId: 30,
        bannedBy: 20,
        bannedAt: new Date(),
      });
      const events = makeEvents();
      const svc = new ModerationService(repo, events);

      await svc.unbanMember({ roomId: 1, adminId: 20, userId: 30 });

      expect(repo.bans.has(FakeModerationRepository.key(1, 30))).toBe(false);
      expect(events.emit).toHaveBeenCalledWith('room.unban', {
        actorId: 20,
        roomId: 1,
        userId: 30,
      });
    });

    it('member cannot unban', async () => {
      const repo = seed();
      const svc = new ModerationService(repo, makeEvents());

      await expect(
        svc.unbanMember({ roomId: 1, adminId: 40, userId: 30 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listBans()', () => {
    it('returns bans for a room (admin access)', async () => {
      const repo = seed();
      repo.bans.set(FakeModerationRepository.key(1, 30), {
        roomId: 1, userId: 30, bannedBy: 20, bannedAt: new Date(),
      });
      repo.bans.set(FakeModerationRepository.key(1, 40), {
        roomId: 1, userId: 40, bannedBy: 20, bannedAt: new Date(),
      });
      const svc = new ModerationService(repo, makeEvents());

      const bans = await svc.listBans({ roomId: 1, viewerId: 20 });
      expect(bans).toHaveLength(2);
      expect(bans.every((b) => b.roomId === 1)).toBe(true);
    });

    it('non-member cannot view ban list', async () => {
      const repo = seed();
      const svc = new ModerationService(repo, makeEvents());

      await expect(
        svc.listBans({ roomId: 1, viewerId: 999 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('promote() / demote()', () => {
    it('owner promotes a member to admin + emits room.role.promote', async () => {
      const repo = seed();
      const events = makeEvents();
      const svc = new ModerationService(repo, events);

      await svc.promote({ roomId: 1, actorId: 10, userId: 30 });

      expect(repo.memberships.get(FakeModerationRepository.key(1, 30))?.role).toBe('admin');
      expect(events.emit).toHaveBeenCalledWith('room.role.promote', {
        actorId: 10,
        roomId: 1,
        userId: 30,
        newRole: 'admin',
      });
    });

    it('non-owner cannot promote', async () => {
      const repo = seed();
      const svc = new ModerationService(repo, makeEvents());

      await expect(
        svc.promote({ roomId: 1, actorId: 20, userId: 30 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('owner demotes an admin to member + emits room.role.demote', async () => {
      const repo = seed();
      const events = makeEvents();
      const svc = new ModerationService(repo, events);

      await svc.demote({ roomId: 1, actorId: 10, userId: 20 });

      expect(repo.memberships.get(FakeModerationRepository.key(1, 20))?.role).toBe('member');
      expect(events.emit).toHaveBeenCalledWith('room.role.demote', {
        actorId: 10,
        roomId: 1,
        userId: 20,
        newRole: 'member',
      });
    });

    it('owner cannot demote themself (AC-06-02)', async () => {
      const repo = seed();
      const svc = new ModerationService(repo, makeEvents());

      await expect(
        svc.demote({ roomId: 1, actorId: 10, userId: 10 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('promote is idempotent when target is already admin (no event)', async () => {
      const repo = seed();
      const events = makeEvents();
      const svc = new ModerationService(repo, events);

      await svc.promote({ roomId: 1, actorId: 10, userId: 20 });
      expect(repo.memberships.get(FakeModerationRepository.key(1, 20))?.role).toBe('admin');
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('promote refuses to promote non-member (NotFound)', async () => {
      const repo = seed();
      const svc = new ModerationService(repo, makeEvents());
      await expect(
        svc.promote({ roomId: 1, actorId: 10, userId: 999 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('promote forbidden when target is the owner', async () => {
      const repo = seed();
      const svc = new ModerationService(repo, makeEvents());
      await expect(
        svc.promote({ roomId: 1, actorId: 10, userId: 10 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('demote is idempotent when target is already member (no event)', async () => {
      const repo = seed();
      const events = makeEvents();
      const svc = new ModerationService(repo, events);

      await svc.demote({ roomId: 1, actorId: 10, userId: 30 });
      expect(repo.memberships.get(FakeModerationRepository.key(1, 30))?.role).toBe('member');
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('demote refuses to demote non-member (NotFound)', async () => {
      const repo = seed();
      const svc = new ModerationService(repo, makeEvents());
      await expect(
        svc.demote({ roomId: 1, actorId: 10, userId: 999 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('demote forbidden when target is the owner', async () => {
      const repo = seed();
      repo.memberships.set(FakeModerationRepository.key(1, 50), {
        roomId: 1, userId: 50, role: 'owner',
      });
      const svc = new ModerationService(repo, makeEvents());
      await expect(
        svc.demote({ roomId: 1, actorId: 10, userId: 50 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteRoom()', () => {
    it('owner soft-deletes room + emits room.delete', async () => {
      const repo = seed();
      const events = makeEvents();
      const svc = new ModerationService(repo, events);

      await svc.deleteRoom({ roomId: 1, actorId: 10 });

      expect(repo.rooms.get(1)?.deletedAt).not.toBeNull();
      expect(events.emit).toHaveBeenCalledWith('room.delete', {
        actorId: 10,
        roomId: 1,
      });
    });

    it('admin (not owner) cannot delete room', async () => {
      const repo = seed();
      const svc = new ModerationService(repo, makeEvents());

      await expect(
        svc.deleteRoom({ roomId: 1, actorId: 20 }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
