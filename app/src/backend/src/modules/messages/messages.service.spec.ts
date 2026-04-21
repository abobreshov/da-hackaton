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
  IsFriendChecker,
  ListMessagesInput,
  MessageRow,
  MessagesRepositoryPort,
  SinceMessagesInput,
} from './messages.types';
import type {
  AttachmentRow,
  AttachmentsRepositoryPort,
  BindAttachmentsInput,
  CreateAttachmentInput,
} from '../attachments/attachments.types';
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

function makeRoomsAuth(
  isMember = true,
  role: 'owner' | 'admin' | 'member' | null = 'member',
): FakeRoomsAuth {
  return {
    ensureMember: jest.fn(async () => {
      if (!isMember) throw new ForbiddenException('not a member of this room');
      return { ok: true };
    }),
    roleOf: jest.fn(async () => role),
  };
}

class FakeAttachmentsRepository implements AttachmentsRepositoryPort {
  rows: AttachmentRow[] = [];
  bindCalls: BindAttachmentsInput[] = [];

  async insertAttachment(input: CreateAttachmentInput): Promise<AttachmentRow> {
    const row: AttachmentRow = {
      id: input.id,
      roomId: input.roomId,
      dmId: input.dmId,
      messageId: null,
      uploaderId: input.uploaderId,
      filename: input.filename,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      path: input.path,
      comment: input.comment,
      isImage: input.isImage,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async findById(id: string): Promise<AttachmentRow | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findByMessageId(messageId: bigint): Promise<AttachmentRow[]> {
    return this.rows.filter((r) => r.messageId === messageId);
  }

  findByMessageIdsCalls: bigint[][] = [];
  async findByMessageIds(ids: bigint[]): Promise<Map<bigint, AttachmentRow[]>> {
    this.findByMessageIdsCalls.push([...ids]);
    const map = new Map<bigint, AttachmentRow[]>();
    if (ids.length === 0) return map;
    const set = new Set(ids.map((i) => i.toString()));
    for (const r of this.rows) {
      if (r.messageId == null) continue;
      if (!set.has(r.messageId.toString())) continue;
      const list = map.get(r.messageId);
      if (list) list.push(r);
      else map.set(r.messageId, [r]);
    }
    return map;
  }

  async bindAttachmentsToMessage(input: BindAttachmentsInput): Promise<AttachmentRow[]> {
    this.bindCalls.push(input);
    if (input.attachmentIds.length === 0) return [];
    const bound: AttachmentRow[] = [];
    for (const id of input.attachmentIds) {
      const r = this.rows.find((x) => x.id === id);
      if (!r) continue;
      if (r.messageId != null) continue;
      if (r.uploaderId !== input.uploaderId) continue;
      if ('roomId' in input.scope) {
        if (r.roomId !== input.scope.roomId) continue;
      } else if (r.dmId !== input.scope.dmId) continue;
      r.messageId = input.messageId;
      bound.push(r);
    }
    return bound;
  }

  async isDmParticipant(): Promise<boolean> {
    return true;
  }
}

const AUTHOR = 10;
const OTHER = 20;
const ADMIN = 30;

interface CapturedEvent {
  event: string;
  payload: unknown;
}

class FakeEventPublisher {
  readonly events: CapturedEvent[] = [];
  emit(event: string, payload: unknown): void {
    this.events.push({ event, payload });
  }
  on(): void {
    // unused in service tests
  }
}

/**
 * In-memory friend checker — default-allows so existing happy-path DM tests
 * keep passing without every test having to set up friendship state. New
 * tests that exercise the FRIEND_REQUIRED gate flip `isFriend = false`.
 */
class FakeFriendsChecker implements IsFriendChecker {
  isFriend = true;
  calls: Array<[number, number]> = [];
  async isFriends(a: number, b: number): Promise<boolean> {
    this.calls.push([a, b]);
    return this.isFriend;
  }
}

describe('MessagesService', () => {
  let repo: FakeMessagesRepository;
  let attachments: FakeAttachmentsRepository;
  let publisher: FakeEventPublisher;
  let friends: FakeFriendsChecker;

  beforeEach(() => {
    repo = new FakeMessagesRepository();
    attachments = new FakeAttachmentsRepository();
    publisher = new FakeEventPublisher();
    friends = new FakeFriendsChecker();
  });

  function make(rooms: any = makeRoomsAuth(), messagesRepo: any = repo): MessagesService {
    return new MessagesService(messagesRepo, rooms, attachments, publisher as any, friends);
  }

  describe('create — XOR scope', () => {
    it('rejects when neither roomId nor dmUserId is present', async () => {
      const svc = new MessagesService(
        repo,
        makeRoomsAuth() as any,
        attachments,
        publisher as any,
        friends,
      );
      await expect(svc.create({ authorId: AUTHOR, body: 'hi' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects when both roomId and dmUserId are present', async () => {
      const svc = make();
      await expect(
        svc.create({ authorId: AUTHOR, roomId: 1, dmUserId: OTHER, body: 'hi' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects body > 3 KiB (AC-07-02)', async () => {
      const svc = make();
      const bigBody = 'a'.repeat(3 * 1024 + 1);
      await expect(
        svc.create({ authorId: AUTHOR, roomId: 1, body: bigBody }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects empty body', async () => {
      const svc = make();
      await expect(svc.create({ authorId: AUTHOR, roomId: 1, body: '' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        svc.create({ authorId: AUTHOR, roomId: 1, body: '   \n\t' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('create — room path', () => {
    it('creates a room message after membership check passes', async () => {
      const rooms = makeRoomsAuth(true);
      const svc = make(rooms);

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
      const svc = make(rooms);
      await expect(svc.create({ authorId: AUTHOR, roomId: 5, body: 'hi' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.messages).toHaveLength(0);
    });

    it('accepts a replyToId pointing at an existing non-deleted message', async () => {
      const rooms = makeRoomsAuth(true);
      const svc = make(rooms);
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
      const svc = make();
      const out = await svc.create({ authorId: AUTHOR, dmUserId: OTHER, body: 'hey' });
      expect(repo.channels).toHaveLength(1);
      expect(repo.channels[0]).toMatchObject({
        userLow: Math.min(AUTHOR, OTHER),
        userHigh: Math.max(AUTHOR, OTHER),
      });
      expect(out.message).toMatchObject({ dmId: repo.channels[0].id, roomId: null });
    });

    it('returns 403 DM_FROZEN WireError when dm_channels.frozen_at is set', async () => {
      const svc = make();
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
      const svc = make();
      await expect(
        svc.create({ authorId: AUTHOR, dmUserId: AUTHOR, body: 'hi me' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('create — DM friend gate (M4-review HIGH)', () => {
    it('rejects with FRIEND_REQUIRED 403 when peer is not an accepted friend', async () => {
      friends.isFriend = false;
      const svc = make();
      try {
        await svc.create({ authorId: AUTHOR, dmUserId: OTHER, body: 'hi stranger' });
        fail('expected FRIEND_REQUIRED HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const e = err as HttpException;
        expect(e.getStatus()).toBe(403);
        expect(e.getResponse()).toMatchObject({ code: ErrorCode.FRIEND_REQUIRED });
      }
      // Critical: no dm_channels row was created — that was the whole point
      // of moving the gate before upsertDmChannel.
      expect(repo.channels).toHaveLength(0);
      expect(repo.messages).toHaveLength(0);
    });

    it('rejects with DM_FROZEN 403 when an existing channel is frozen, before upsert', async () => {
      // Provision via the happy path, then freeze.
      const svc = make();
      await svc.create({ authorId: AUTHOR, dmUserId: OTHER, body: 'first' });
      repo.channels[0].frozenAt = new Date();
      const channelsBefore = repo.channels.length;

      try {
        await svc.create({ authorId: AUTHOR, dmUserId: OTHER, body: 'still there?' });
        fail('expected DM_FROZEN HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const e = err as HttpException;
        expect(e.getStatus()).toBe(403);
        expect(e.getResponse()).toMatchObject({ code: ErrorCode.DM_FROZEN });
      }
      // No new channel row, no new message row.
      expect(repo.channels).toHaveLength(channelsBefore);
      expect(repo.messages).toHaveLength(1);
    });

    it('does not call friends.isFriends on the room path', async () => {
      const rooms = makeRoomsAuth(true);
      const svc = make(rooms);
      await svc.create({ authorId: AUTHOR, roomId: 5, body: 'hi room' });
      expect(friends.calls).toHaveLength(0);
    });
  });

  describe('create — attachment binding (EPIC-08)', () => {
    it('does not call bindAttachmentsToMessage when attachmentIds is omitted', async () => {
      const svc = make();
      const out = await svc.create({ authorId: AUTHOR, roomId: 5, body: 'hi' });
      expect(attachments.bindCalls).toHaveLength(0);
      expect(out).toMatchObject({ attachments: [] });
    });

    it('does not call bindAttachmentsToMessage when attachmentIds is empty', async () => {
      const svc = make();
      const out = await svc.create({
        authorId: AUTHOR,
        roomId: 5,
        body: 'hi',
        attachmentIds: [],
      });
      expect(attachments.bindCalls).toHaveLength(0);
      expect(out).toMatchObject({ attachments: [] });
    });

    it('binds attachmentIds with room scope + uploaderId + newly-created messageId', async () => {
      // Seed two orphan attachments for AUTHOR in room 5.
      await attachments.insertAttachment({
        id: 'att-1',
        roomId: 5,
        dmId: null,
        uploaderId: AUTHOR,
        filename: 'a.png',
        mime: 'image/png',
        sizeBytes: 10,
        path: '/tmp/a',
        comment: null,
        isImage: true,
      });
      await attachments.insertAttachment({
        id: 'att-2',
        roomId: 5,
        dmId: null,
        uploaderId: AUTHOR,
        filename: 'b.png',
        mime: 'image/png',
        sizeBytes: 20,
        path: '/tmp/b',
        comment: null,
        isImage: true,
      });

      const svc = make();
      const out = await svc.create({
        authorId: AUTHOR,
        roomId: 5,
        body: 'with attachments',
        attachmentIds: ['att-1', 'att-2'],
      });

      expect(attachments.bindCalls).toHaveLength(1);
      expect(attachments.bindCalls[0]).toEqual({
        attachmentIds: ['att-1', 'att-2'],
        messageId: out.message.id,
        uploaderId: AUTHOR,
        scope: { roomId: 5 },
      });
      expect(out.attachments).toHaveLength(2);
      expect(out.attachments.map((a: any) => a.id).sort()).toEqual(['att-1', 'att-2']);
    });

    it('binds attachmentIds with DM scope on the DM path', async () => {
      const svc = make();
      // First message provisions the DM channel so we know its id.
      const bootstrap = await svc.create({ authorId: AUTHOR, dmUserId: OTHER, body: 'hi' });
      const dmId = bootstrap.message.dmId!;

      await attachments.insertAttachment({
        id: 'dm-att-1',
        roomId: null,
        dmId,
        uploaderId: AUTHOR,
        filename: 'c.png',
        mime: 'image/png',
        sizeBytes: 30,
        path: '/tmp/c',
        comment: null,
        isImage: true,
      });

      const out = await svc.create({
        authorId: AUTHOR,
        dmUserId: OTHER,
        body: 'with attach',
        attachmentIds: ['dm-att-1'],
      });

      expect(attachments.bindCalls).toHaveLength(1);
      expect(attachments.bindCalls[0]).toEqual({
        attachmentIds: ['dm-att-1'],
        messageId: out.message.id,
        uploaderId: AUTHOR,
        scope: { dmId },
      });
      expect(out.attachments).toHaveLength(1);
      expect(out.attachments[0].id).toBe('dm-att-1');
    });

    it('does NOT call bindAttachmentsToMessage when DM_FROZEN rejection fires', async () => {
      const svc = make();
      // Provision + freeze.
      await svc.create({ authorId: AUTHOR, dmUserId: OTHER, body: 'ping' });
      repo.channels[0].frozenAt = new Date();
      attachments.bindCalls = [];

      await expect(
        svc.create({
          authorId: AUTHOR,
          dmUserId: OTHER,
          body: 'still there?',
          attachmentIds: ['whatever'],
        }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(attachments.bindCalls).toHaveLength(0);
    });
  });

  describe('create — event emission (EPIC-09 unread)', () => {
    it('emits message.created with room scope payload after room insert', async () => {
      const svc = make();
      const out = await svc.create({ authorId: AUTHOR, roomId: 7, body: 'hi' });

      const created = publisher.events.filter((e) => e.event === 'message.created');
      expect(created).toHaveLength(1);
      expect(created[0].payload).toEqual({
        scope: 'room',
        messageId: out.message.id,
        authorId: AUTHOR,
        roomId: 7,
      });
    });

    it('emits message.created with dm scope + peerUserId after DM insert', async () => {
      const svc = make();
      const out = await svc.create({ authorId: AUTHOR, dmUserId: OTHER, body: 'hey' });

      const created = publisher.events.filter((e) => e.event === 'message.created');
      expect(created).toHaveLength(1);
      expect(created[0].payload).toEqual({
        scope: 'dm',
        messageId: out.message.id,
        authorId: AUTHOR,
        dmId: out.message.dmId,
        peerUserId: OTHER,
      });
    });

    it('does NOT emit message.created when DM_FROZEN rejection fires', async () => {
      const svc = make();
      await svc.create({ authorId: AUTHOR, dmUserId: OTHER, body: 'ping' });
      repo.channels[0].frozenAt = new Date();
      publisher.events.length = 0;

      await expect(
        svc.create({ authorId: AUTHOR, dmUserId: OTHER, body: 'still there?' }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(publisher.events.filter((e) => e.event === 'message.created')).toHaveLength(0);
    });

    it('does NOT emit message.created when room membership rejection fires', async () => {
      const rooms = makeRoomsAuth(false);
      const svc = make(rooms);
      await expect(svc.create({ authorId: AUTHOR, roomId: 5, body: 'hi' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(publisher.events.filter((e) => e.event === 'message.created')).toHaveLength(0);
    });
  });

  describe('edit (AC-07-04, AC-07-17)', () => {
    it('updates body + stamps editedAt for the author', async () => {
      const svc = make();
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'orig' });
      const updated = await svc.edit({ id: message.id, actorId: AUTHOR, body: 'fixed' });
      expect(updated.message.body).toBe('fixed');
      expect(updated.message.editedAt).toBeInstanceOf(Date);
    });

    it('rejects edits from non-author (ForbiddenException)', async () => {
      const svc = make();
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'orig' });
      await expect(
        svc.edit({ id: message.id, actorId: OTHER, body: 'nope' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects empty or >3KB edits', async () => {
      const svc = make();
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'orig' });
      await expect(svc.edit({ id: message.id, actorId: AUTHOR, body: '' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        svc.edit({ id: message.id, actorId: AUTHOR, body: 'x'.repeat(3 * 1024 + 1) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when the message does not exist', async () => {
      const svc = make();
      await expect(svc.edit({ id: 999n, actorId: AUTHOR, body: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the message is already soft-deleted', async () => {
      const svc = make();
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'orig' });
      await svc.delete({ id: message.id, actorId: AUTHOR, isRoomAdmin: false });
      await expect(svc.edit({ id: message.id, actorId: AUTHOR, body: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('does NOT enforce a time window (AC-07-17)', async () => {
      const svc = make();
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
      const svc = make();
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'hi' });
      await svc.delete({ id: message.id, actorId: AUTHOR, isRoomAdmin: false });
      const row = repo.messages.find((m) => m.id === message.id)!;
      expect(row.deletedAt).toBeInstanceOf(Date);
    });

    it('room admin can delete any message in that room', async () => {
      const svc = make();
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'hi' });
      await svc.delete({ id: message.id, actorId: ADMIN, isRoomAdmin: true });
      const row = repo.messages.find((m) => m.id === message.id)!;
      expect(row.deletedAt).toBeInstanceOf(Date);
    });

    it('non-author non-admin cannot delete', async () => {
      const svc = make();
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'hi' });
      await expect(
        svc.delete({ id: message.id, actorId: OTHER, isRoomAdmin: false }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException for missing id', async () => {
      const svc = make();
      await expect(
        svc.delete({ id: 9999n, actorId: AUTHOR, isRoomAdmin: false }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('idempotent: second delete of same message throws NotFoundException', async () => {
      const svc = make();
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'hi' });
      await svc.delete({ id: message.id, actorId: AUTHOR, isRoomAdmin: false });
      await expect(
        svc.delete({ id: message.id, actorId: AUTHOR, isRoomAdmin: false }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list — keyset pagination (AC-07-20)', () => {
    it('returns most recent first, capped at limit', async () => {
      const svc = make();
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
      const svc = make();
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
       
      void c;
    });

    it('filters deleted messages out of the list', async () => {
      const svc = make();
      const one = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'keep' });
      const two = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'drop' });
      await svc.delete({ id: two.message.id, actorId: AUTHOR, isRoomAdmin: false });
      const out = await svc.list({ roomId: 1, limit: 10 });
      expect(out.messages.map((m) => m.body)).toEqual(['keep']);
       
      void one;
    });

    it('rejects a list call with neither scope set', async () => {
      const svc = make();
      await expect(svc.list({ limit: 10 } as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('caps limit to a hard maximum (50)', async () => {
      const svc = make();
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
      const svc2 = make(makeRoomsAuth(), probeRepo);
      await svc2.list({ roomId: 1, limit: 9999 });
      expect(captured[0].limit).toBeLessThanOrEqual(50);
    });
  });

  describe('list — attachments hydration (M4 deferral)', () => {
    async function seedAtt(
      svc: MessagesService,
      messageId: bigint,
      attId: string,
      roomId = 1,
    ): Promise<void> {
      void svc;
      await attachments.insertAttachment({
        id: attId,
        roomId,
        dmId: null,
        uploaderId: AUTHOR,
        filename: `${attId}.png`,
        mime: 'image/png',
        sizeBytes: 1,
        path: `/tmp/${attId}`,
        comment: null,
        isImage: true,
      });
      const r = attachments.rows.find((x) => x.id === attId)!;
      r.messageId = messageId;
    }

    it('returns empty attachmentsByMessageId map when no rows have attachments', async () => {
      const svc = make();
      await svc.create({ authorId: AUTHOR, roomId: 1, body: 'hi' });
      const out = await svc.list({ roomId: 1, limit: 10 });
      expect(out).toMatchObject({ attachmentsByMessageId: {} });
      expect(out.messages).toHaveLength(1);
    });

    it('groups attachments by messageId on the wire (string-keyed)', async () => {
      const svc = make();
      const m1 = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'one' });
      const m2 = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'two' });
      await seedAtt(svc, m1.message.id, 'a1');
      await seedAtt(svc, m1.message.id, 'a2');
      await seedAtt(svc, m2.message.id, 'b1');

      const out = await svc.list({ roomId: 1, limit: 10 });

      expect(Object.keys(out.attachmentsByMessageId).sort()).toEqual(
        [m1.message.id.toString(), m2.message.id.toString()].sort(),
      );
      expect(out.attachmentsByMessageId[m1.message.id.toString()].map((a) => a.id).sort()).toEqual([
        'a1',
        'a2',
      ]);
      expect(out.attachmentsByMessageId[m2.message.id.toString()].map((a) => a.id)).toEqual(['b1']);
    });

    it('skips the attachments lookup entirely when the page is empty', async () => {
      const svc = make();
      attachments.findByMessageIdsCalls = [];
      const out = await svc.list({ roomId: 1, limit: 10 });
      expect(out.messages).toHaveLength(0);
      expect(out.attachmentsByMessageId).toEqual({});
      expect(attachments.findByMessageIdsCalls).toHaveLength(0);
    });

    it('queries findByMessageIds with exactly the page-resident message ids', async () => {
      const svc = make();
      const a = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'a' });
      const b = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'b' });
      attachments.findByMessageIdsCalls = [];
      await svc.list({ roomId: 1, limit: 10 });
      expect(attachments.findByMessageIdsCalls).toHaveLength(1);
      expect([...attachments.findByMessageIdsCalls[0]].sort()).toEqual(
        [a.message.id, b.message.id].sort(),
      );
    });
  });

  describe('since — reconnect hydrate', () => {
    it('returns messages with id > lastSeenId (ascending)', async () => {
      const svc = make();
      const a = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'a' });
      const b = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'b' });
      const c = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'c' });
      const out = await svc.since({ roomId: 1, lastSeenId: a.message.id, limit: 50 });
      expect(out.messages.map((m) => m.id)).toEqual([b.message.id, c.message.id]);
    });

    it('requires at least one of roomId / dmId', async () => {
      const svc = make();
      await expect(svc.since({ lastSeenId: 0n, limit: 50 } as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('hydrates attachmentsByMessageId for the resulting page (M4 deferral)', async () => {
      const svc = make();
      const a = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'a' });
      const b = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'b' });
      await attachments.insertAttachment({
        id: 'att-since',
        roomId: 1,
        dmId: null,
        uploaderId: AUTHOR,
        filename: 'x.png',
        mime: 'image/png',
        sizeBytes: 1,
        path: '/tmp/x',
        comment: null,
        isImage: true,
      });
      attachments.rows.find((r) => r.id === 'att-since')!.messageId = b.message.id;

      const out = await svc.since({ roomId: 1, lastSeenId: a.message.id, limit: 50 });
      expect(out.messages.map((m) => m.id)).toEqual([b.message.id]);
      expect(out.attachmentsByMessageId).toEqual({
        [b.message.id.toString()]: expect.arrayContaining([expect.objectContaining({ id: 'att-since' })]),
      });
    });
  });

  describe('resolveOrCreateDmChannelId — friend gate (M5-review MED #7)', () => {
    it('returns dmId on the happy path when peers are friends', async () => {
      const svc = make();
      const out = await svc.resolveOrCreateDmChannelId(AUTHOR, OTHER);
      expect(out.dmId).toBe(repo.channels[0].id);
      expect(repo.channels).toHaveLength(1);
    });

    it('rejects self with BadRequestException without touching the repo', async () => {
      const svc = make();
      await expect(svc.resolveOrCreateDmChannelId(AUTHOR, AUTHOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.channels).toHaveLength(0);
    });

    it('rejects with FRIEND_REQUIRED 403 when peers are not friends — and never upserts', async () => {
      friends.isFriend = false;
      const svc = make();
      try {
        await svc.resolveOrCreateDmChannelId(AUTHOR, OTHER);
        fail('expected FRIEND_REQUIRED HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const e = err as HttpException;
        expect(e.getStatus()).toBe(403);
        expect(e.getResponse()).toMatchObject({ code: ErrorCode.FRIEND_REQUIRED });
      }
      expect(repo.channels).toHaveLength(0);
    });

    it('rejects with DM_FROZEN 403 when the channel is already frozen', async () => {
      const svc = make();
      // Bootstrap a channel through the message path so the test is honest
      // about how a frozen channel gets there in production.
      await svc.create({ authorId: AUTHOR, dmUserId: OTHER, body: 'hi' });
      repo.channels[0].frozenAt = new Date();

      try {
        await svc.resolveOrCreateDmChannelId(AUTHOR, OTHER);
        fail('expected DM_FROZEN HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const e = err as HttpException;
        expect(e.getStatus()).toBe(403);
        expect(e.getResponse()).toMatchObject({ code: ErrorCode.DM_FROZEN });
      }
    });
  });

  describe('getById', () => {
    it('returns the message row wrapped in { message }', async () => {
      const svc = make();
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'x' });
      const out = await svc.getById(message.id);
      expect(out.message.id).toBe(message.id);
    });

    it('throws NotFoundException when the id is unknown', async () => {
      const svc = make();
      await expect(svc.getById(9999n)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('still returns the row when soft-deleted (caller decides how to render)', async () => {
      const svc = make();
      const { message } = await svc.create({ authorId: AUTHOR, roomId: 1, body: 'x' });
      await svc.delete({ id: message.id, actorId: AUTHOR, isRoomAdmin: false });
      const out = await svc.getById(message.id);
      expect(out.message.deletedAt).toBeInstanceOf(Date);
    });
  });

   
  const _unused_conflict = ConflictException;
});
