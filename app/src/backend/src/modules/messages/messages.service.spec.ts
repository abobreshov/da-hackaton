/**
 * Unit tests for MessagesService (EPIC-07). Uses an in-memory fake repo so
 * we exercise the domain rules — XOR scoping, 3KB cap, DM_FROZEN envelope,
 * keyset shape, edit / delete authorization — without hitting Postgres.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import type {
  DmChannelRow,
  InsertMessageInput,
  ListMessagesInput,
  MessageRow,
  MessagesRepositoryPort,
  SinceMessagesInput,
} from './messages.types';
import { ErrorCode } from '@app/contracts';

class FakeMessagesRepository implements MessagesRepositoryPort {
  messages: MessageRow[] = [];
  channels: DmChannelRow[] = [];
  private nextMsgId = 1n;
  private nextDmId = 1;

  async upsertDmChannel(a: number, b: number): Promise<DmChannelRow> {
    const [low, high] = a < b ? [a, b] : [b, a];
    const existing = this.channels.find((c) => c.userLow === low && c.userHigh === high);
    if (existing) return existing;
    const row: DmChannelRow = {
      id: this.nextDmId++,
      userLow: low,
      userHigh: high,
      createdAt: new Date(),
      frozenAt: null,
    };
    this.channels.push(row);
    return row;
  }

  async findDmChannel(a: number, b: number): Promise<DmChannelRow | null> {
    const [low, high] = a < b ? [a, b] : [b, a];
    return this.channels.find((c) => c.userLow === low && c.userHigh === high) ?? null;
  }

  async insertMessageIfDmNotFrozen(input: InsertMessageInput): Promise<MessageRow | null> {
    if (input.dmId == null) throw new Error('dmId required for this path');
    const channel = this.channels.find((c) => c.id === input.dmId);
    if (channel?.frozenAt) return null;
    return this.insertMessage(input);
  }

  async insertMessage(input: InsertMessageInput): Promise<MessageRow> {
    const row: MessageRow = {
      id: this.nextMsgId++,
      roomId: input.roomId ?? null,
      dmId: input.dmId ?? null,
      authorId: input.authorId,
      body: input.body,
      replyTo: input.replyTo ?? null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date(),
    };
    this.messages.push(row);
    return row;
  }

  async findMessageById(id: bigint): Promise<MessageRow | null> {
    return this.messages.find((m) => m.id === id) ?? null;
  }

  async softDeleteMessage(id: bigint): Promise<MessageRow | null> {
    const row = this.messages.find((m) => m.id === id);
    if (!row || row.deletedAt) return null;
    row.deletedAt = new Date();
    return row;
  }

  async updateMessageBody(id: bigint, body: string): Promise<MessageRow | null> {
    const row = this.messages.find((m) => m.id === id);
    if (!row || row.deletedAt) return null;
    row.body = body;
    row.editedAt = new Date();
    return row;
  }

  async listMessages(input: ListMessagesInput): Promise<MessageRow[]> {
    let filtered = this.messages.filter((m) => m.deletedAt == null);
    if (input.roomId != null) filtered = filtered.filter((m) => m.roomId === input.roomId);
    if (input.dmId != null) filtered = filtered.filter((m) => m.dmId === input.dmId);
    if (input.before) {
      const bTs = input.before.createdAt.getTime();
      const bId = input.before.id;
      filtered = filtered.filter((m) => {
        const ts = m.createdAt?.getTime() ?? 0;
        return ts < bTs || (ts === bTs && m.id < bId);
      });
    }
    filtered.sort((a, b) => {
      const ats = a.createdAt?.getTime() ?? 0;
      const bts = b.createdAt?.getTime() ?? 0;
      if (ats !== bts) return bts - ats;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
    return filtered.slice(0, input.limit);
  }

  async listMessagesSince(input: SinceMessagesInput): Promise<MessageRow[]> {
    let filtered = this.messages.filter((m) => m.deletedAt == null && m.id > input.lastSeenId);
    if (input.roomId != null) filtered = filtered.filter((m) => m.roomId === input.roomId);
    if (input.dmId != null) filtered = filtered.filter((m) => m.dmId === input.dmId);
    filtered.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return filtered.slice(0, input.limit);
  }
}

interface FakeRoomsAuth {
  ensureMember: jest.Mock;
  roleOf?: jest.Mock;
}

function makeRoomsAuth(isMember = true, role: 'owner' | 'admin' | 'member' | null = 'member'): FakeRoomsAuth {
  return {
    ensureMember: jest.fn(async () => {
      if (!isMember) throw new ForbiddenException('not a member of this room');
      return { ok: true };
    }),
    roleOf: jest.fn(async () => role),
  };
}

const AUTHOR = 10;
const OTHER = 20;
const ADMIN = 30;

describe('MessagesService', () => {
  let repo: FakeMessagesRepository;

  beforeEach(() => {
    repo = new FakeMessagesRepository();
  });

  describe('create — XOR scope', () => {
    it('rejects when neither roomId nor dmUserId is present', async () => {
      const svc = new (require('./messages.service').MessagesService)(repo, makeRoomsAuth());
      await expect(
        svc.create({ authorId: AUTHOR, body: 'hi' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when both roomId and dmUserId are present', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      await expect(
        svc.create({ authorId: AUTHOR, roomId: 1, dmUserId: OTHER, body: 'hi' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects body > 3 KiB (AC-07-02)', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const bigBody = 'a'.repeat(3 * 1024 + 1);
      await expect(
        svc.create({ authorId: AUTHOR, roomId: 1, body: bigBody }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects empty body', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      await expect(
        svc.create({ authorId: AUTHOR, roomId: 1, body: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.create({ authorId: AUTHOR, roomId: 1, body: '   \n\t' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('create — room path', () => {
    it('creates a room message after membership check passes', async () => {
      const rooms = makeRoomsAuth(true);
      const svc = new MessagesService(repo, rooms as any);

      const out = await svc.create({ authorId: AUTHOR, roomId: 5, body: 'hello room' });

      expect(rooms.ensureMember).toHaveBeenCalledWith({ roomId: 5, userId: AUTHOR });
      expect(out.message).toMatchObject({
        roomId: 5,
        dmId: null,
        authorId: AUTHOR,
        body: 'hello room',
      });
      expect(repo.messages).toHaveLength(1);
    });

    it('propagates ForbiddenException when caller is not a room member', async () => {
      const rooms = makeRoomsAuth(false);
      const svc = new MessagesService(repo, rooms as any);
      await expect(
        svc.create({ authorId: AUTHOR, roomId: 5, body: 'hi' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.messages).toHaveLength(0);
    });

    it('accepts a replyToId pointing at an existing non-deleted message', async () => {
      const rooms = makeRoomsAuth(true);
      const svc = new MessagesService(repo, rooms as any);
      const first = await svc.create({ authorId: AUTHOR, roomId: 5, body: 'parent' });
      const reply = await svc.create({
        authorId: OTHER,
        roomId: 5,
        body: 'reply',
        replyToId: first.message.id,
      });
      expect(reply.message.replyTo).toBe(first.message.id);
    });
  });

  describe('create — DM path (AC-07-16 + AC-07-19)', () => {
    it('lazily creates dm_channels row and inserts the message', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const out = await svc.create({ authorId: AUTHOR, dmUserId: OTHER, body: 'hey' });
      expect(repo.channels).toHaveLength(1);
      expect(repo.channels[0]).toMatchObject({
        userLow: Math.min(AUTHOR, OTHER),
        userHigh: Math.max(AUTHOR, OTHER),
      });
      expect(out.message).toMatchObject({ dmId: repo.channels[0].id, roomId: null });
    });

    it('returns 403 DM_FROZEN WireError when dm_channels.frozen_at is set', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      // First message provisions the channel.
      await svc.create({ authorId: AUTHOR, dmUserId: OTHER, body: 'ping' });
      // External state flip — simulate BanService freezing the channel.
      repo.channels[0].frozenAt = new Date();

      try {
        await svc.create({ authorId: AUTHOR, dmUserId: OTHER, body: 'still there?' });
        fail('expected DM_FROZEN HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const e = err as HttpException;
        expect(e.getStatus()).toBe(403);
        expect(e.getResponse()).toMatchObject({ code: ErrorCode.DM_FROZEN });
      }
    });

    it('rejects DM to self with BadRequestException', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      await expect(
        svc.create({ authorId: AUTHOR, dmUserId: AUTHOR, body: 'hi me' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('edit (AC-07-04, AC-07-17)', () => {
    it('updates body + stamps editedAt for the author', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'orig' });
      const updated = await svc.edit({ id: message.id, actorId: AUTHOR, body: 'fixed' });
      expect(updated.message.body).toBe('fixed');
      expect(updated.message.editedAt).toBeInstanceOf(Date);
    });

    it('rejects edits from non-author (ForbiddenException)', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'orig' });
      await expect(
        svc.edit({ id: message.id, actorId: OTHER, body: 'nope' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects empty or >3KB edits', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'orig' });
      await expect(
        svc.edit({ id: message.id, actorId: AUTHOR, body: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.edit({ id: message.id, actorId: AUTHOR, body: 'x'.repeat(3 * 1024 + 1) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when the message does not exist', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      await expect(
        svc.edit({ id: 999n, actorId: AUTHOR, body: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the message is already soft-deleted', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'orig' });
      await svc.delete({ id: message.id, actorId: AUTHOR, isRoomAdmin: false });
      await expect(
        svc.edit({ id: message.id, actorId: AUTHOR, body: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does NOT enforce a time window (AC-07-17)', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'ancient' });
      // Age the row out past any would-be MVP window.
      const row = repo.messages.find((m) => m.id === message.id)!;
      row.createdAt = new Date(Date.now() - 365 * 24 * 3600_000);
      await expect(
        svc.edit({ id: message.id, actorId: AUTHOR, body: 'still allowed' }),
      ).resolves.toBeTruthy();
    });
  });

  describe('delete (AC-07-05, AC-07-06)', () => {
    it('author can soft-delete their own message', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'hi' });
      await svc.delete({ id: message.id, actorId: AUTHOR, isRoomAdmin: false });
      const row = repo.messages.find((m) => m.id === message.id)!;
      expect(row.deletedAt).toBeInstanceOf(Date);
    });

    it('room admin can delete any message in that room', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'hi' });
      await svc.delete({ id: message.id, actorId: ADMIN, isRoomAdmin: true });
      const row = repo.messages.find((m) => m.id === message.id)!;
      expect(row.deletedAt).toBeInstanceOf(Date);
    });

    it('non-author non-admin cannot delete', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'hi' });
      await expect(
        svc.delete({ id: message.id, actorId: OTHER, isRoomAdmin: false }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException for missing id', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      await expect(
        svc.delete({ id: 9999n, actorId: AUTHOR, isRoomAdmin: false }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('idempotent: second delete of same message throws NotFoundException', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'hi' });
      await svc.delete({ id: message.id, actorId: AUTHOR, isRoomAdmin: false });
      await expect(
        svc.delete({ id: message.id, actorId: AUTHOR, isRoomAdmin: false }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list — keyset pagination (AC-07-20)', () => {
    it('returns most recent first, capped at limit', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      for (let i = 0; i < 5; i++) {
        await svc.create({ authorId: AUTHOR, roomId: 1, body: `m${i}` });
        // Ensure distinct createdAt to exercise the ordering path.
        const row = repo.messages[repo.messages.length - 1];
        row.createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, i));
      }

      const out = await svc.list({ roomId: 1, limit: 3 });
      expect(out.messages.map((m) => m.body)).toEqual(['m4', 'm3', 'm2']);
    });

    it('respects the composite cursor — id breaks ties on identical createdAt', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const a = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'a' });
      const b = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'b' });
      const c = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'c' });
      const sameTs = new Date(Date.UTC(2026, 0, 1));
      for (const row of repo.messages) row.createdAt = sameTs;

      // cursor = (sameTs, b.id) — should only see messages with id < b.id, i.e. a.
      const out = await svc.list({
        roomId: 1,
        limit: 10,
        before: { createdAt: sameTs, id: b.message.id },
      });
      expect(out.messages.map((m) => m.body)).toEqual(['a']);

      // No cursor → all three, descending.
      const full = await svc.list({ roomId: 1, limit: 10 });
      expect(full.messages.map((m) => m.body)).toEqual(['c', 'b', 'a']);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      void c;
    });

    it('filters deleted messages out of the list', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const one = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'keep' });
      const two = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'drop' });
      await svc.delete({ id: two.message.id, actorId: AUTHOR, isRoomAdmin: false });
      const out = await svc.list({ roomId: 1, limit: 10 });
      expect(out.messages.map((m) => m.body)).toEqual(['keep']);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      void one;
    });

    it('rejects a list call with neither scope set', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      await expect(svc.list({ limit: 10 } as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('caps limit to a hard maximum (50)', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const out = await svc.list({ roomId: 1, limit: 9999 });
      expect(out).toBeDefined();
      // The fake tolerates unbounded; we just assert the service adjusts.
      // Real assertion: service clamps limit — surface that via a probe.
      // Using a mock repo to capture the passed-through limit:
      const captured: ListMessagesInput[] = [];
      const probeRepo: MessagesRepositoryPort = {
        ...repo,
        listMessages: async (inp: ListMessagesInput) => {
          captured.push(inp);
          return [];
        },
      } as any;
      const svc2 = new MessagesService(probeRepo, makeRoomsAuth() as any);
      await svc2.list({ roomId: 1, limit: 9999 });
      expect(captured[0].limit).toBeLessThanOrEqual(50);
    });
  });

  describe('since — reconnect hydrate', () => {
    it('returns messages with id > lastSeenId (ascending)', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const a = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'a' });
      const b = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'b' });
      const c = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'c' });
      const out = await svc.since({ roomId: 1, lastSeenId: a.message.id, limit: 50 });
      expect(out.messages.map((m) => m.id)).toEqual([b.message.id, c.message.id]);
    });

    it('requires at least one of roomId / dmId', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      await expect(
        svc.since({ lastSeenId: 0n, limit: 50 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getById', () => {
    it('returns the message row wrapped in { message }', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'x' });
      const out = await svc.getById(message.id);
      expect(out.message.id).toBe(message.id);
    });

    it('throws NotFoundException when the id is unknown', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      await expect(svc.getById(9999n)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('still returns the row when soft-deleted (caller decides how to render)', async () => {
      const svc = new MessagesService(repo, makeRoomsAuth() as any);
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'x' });
      await svc.delete({ id: message.id, actorId: AUTHOR, isRoomAdmin: false });
      const out = await svc.getById(message.id);
      expect(out.message.deletedAt).toBeInstanceOf(Date);
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _unused_conflict = ConflictException;
});
