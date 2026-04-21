import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  AttachmentRow,
  AttachmentsRepositoryPort,
  BindAttachmentsInput,
  CreateAttachmentInput,
} from './attachments.types';
import { AttachmentStoragePort, WriteAttachmentInput } from './storage/attachment-storage.types';
import { AttachmentsService, MAX_FILE_BYTES, MAX_IMAGE_BYTES } from './attachments.service';

class FakeRepo implements AttachmentsRepositoryPort {
  rows = new Map<string, AttachmentRow>();
  dmParticipants = new Map<number, Set<number>>();

  async insertAttachment(input: CreateAttachmentInput): Promise<AttachmentRow> {
    const row: AttachmentRow = {
      ...input,
      messageId: null,
      createdAt: new Date('2026-04-20T00:00:00Z'),
    };
    this.rows.set(input.id, row);
    return row;
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByMessageId(messageId: bigint) {
    return [...this.rows.values()].filter((r) => r.messageId === messageId);
  }
  async findByMessageIds(ids: bigint[]) {
    const map = new Map<bigint, AttachmentRow[]>();
    if (ids.length === 0) return map;
    const set = new Set(ids.map((i) => i.toString()));
    for (const r of this.rows.values()) {
      if (r.messageId == null) continue;
      if (!set.has(r.messageId.toString())) continue;
      const list = map.get(r.messageId);
      if (list) list.push(r);
      else map.set(r.messageId, [r]);
    }
    return map;
  }
  async bindAttachmentsToMessage(input: BindAttachmentsInput) {
    const bound: AttachmentRow[] = [];
    for (const id of input.attachmentIds) {
      const row = this.rows.get(id);
      if (!row || row.uploaderId !== input.uploaderId || row.messageId !== null) continue;
      const scopeOk =
        ('roomId' in input.scope && row.roomId === input.scope.roomId) ||
        ('dmId' in input.scope && row.dmId === input.scope.dmId);
      if (!scopeOk) continue;
      row.messageId = input.messageId;
      bound.push(row);
    }
    return bound;
  }
  async isDmParticipant(dmId: number, userId: number) {
    return !!this.dmParticipants.get(dmId)?.has(userId);
  }
}

class FakeStorage implements AttachmentStoragePort {
  stored = new Map<string, Buffer>();
  async write(input: WriteAttachmentInput) {
    const path = `2026/04/${input.id}_${input.filename}`;
    this.stored.set(path, input.content);
    return path;
  }
  async read(path: string) {
    const content = this.stored.get(path);
    if (!content) throw new Error('ENOENT ' + path);
    return content;
  }
  async unlink(path: string) {
    this.stored.delete(path);
  }
}

class FakeRooms {
  memberships = new Set<string>(); // `${roomId}:${userId}`
  allow(roomId: number, userId: number) {
    this.memberships.add(`${roomId}:${userId}`);
  }
  async ensureMember(input: { roomId: number; userId: number }) {
    if (!this.memberships.has(`${input.roomId}:${input.userId}`)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'not a member' });
    }
    return { ok: true as const };
  }
}

function makeService() {
  const repo = new FakeRepo();
  const storage = new FakeStorage();
  const rooms = new FakeRooms();
  // Service only calls .ensureMember — satisfy via cast to any rather than
  // stubbing the full RoomsService surface.
  const service = new AttachmentsService(repo, storage, rooms as any);
  return { service, repo, storage, rooms };
}

describe('AttachmentsService', () => {
  describe('upload — size guards', () => {
    it('rejects image > MAX_IMAGE_BYTES with 413 + VALIDATION_FAILED', async () => {
      const { service, rooms } = makeService();
      rooms.allow(1, 42);
      const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);
      await expect(
        service.upload({
          uploaderId: 42,
          scope: { roomId: 1 },
          filename: 'big.png',
          mime: 'image/png',
          content: big,
        }),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    });

    it('accepts image at exactly MAX_IMAGE_BYTES', async () => {
      const { service, rooms } = makeService();
      rooms.allow(1, 42);
      const ok = Buffer.alloc(MAX_IMAGE_BYTES);
      const row = await service.upload({
        uploaderId: 42,
        scope: { roomId: 1 },
        filename: 'ok.png',
        mime: 'image/png',
        content: ok,
      });
      expect(row.isImage).toBe(true);
      expect(row.sizeBytes).toBe(MAX_IMAGE_BYTES);
    });

    it('rejects non-image > MAX_FILE_BYTES with 413', async () => {
      const { service, rooms } = makeService();
      rooms.allow(1, 42);
      const big = Buffer.alloc(MAX_FILE_BYTES + 1);
      await expect(
        service.upload({
          uploaderId: 42,
          scope: { roomId: 1 },
          filename: 'big.bin',
          mime: 'application/octet-stream',
          content: big,
        }),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    });

    it('rejects empty file with 400', async () => {
      const { service, rooms } = makeService();
      rooms.allow(1, 42);
      await expect(
        service.upload({
          uploaderId: 42,
          scope: { roomId: 1 },
          filename: 'x.bin',
          mime: 'application/octet-stream',
          content: Buffer.alloc(0),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects oversized filename (>255 chars)', async () => {
      const { service, rooms } = makeService();
      rooms.allow(1, 42);
      await expect(
        service.upload({
          uploaderId: 42,
          scope: { roomId: 1 },
          filename: 'x'.repeat(256),
          mime: 'image/png',
          content: Buffer.from('a'),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('upload — membership gate', () => {
    it('non-member in room-scope → ForbiddenException via ensureMember', async () => {
      const { service } = makeService(); // no allow
      await expect(
        service.upload({
          uploaderId: 42,
          scope: { roomId: 1 },
          filename: 'a.txt',
          mime: 'text/plain',
          content: Buffer.from('a'),
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('member upload persists + FS write + returns row', async () => {
      const { service, repo, storage, rooms } = makeService();
      rooms.allow(1, 42);
      const row = await service.upload({
        uploaderId: 42,
        scope: { roomId: 1 },
        filename: 'hello.txt',
        mime: 'text/plain',
        content: Buffer.from('hello'),
      });
      expect(row.roomId).toBe(1);
      expect(row.dmId).toBeNull();
      expect(row.uploaderId).toBe(42);
      expect(row.mime).toBe('text/plain');
      expect(row.isImage).toBe(false);
      expect(row.path).toMatch(new RegExp(`2026/04/.+_hello\\.txt`));
      expect(repo.rows.size).toBe(1);
      expect(storage.stored.has(row.path)).toBe(true);
    });
  });

  describe('download — ACL', () => {
    it('missing attachment → 404', async () => {
      const { service } = makeService();
      await expect(service.download('none', 42)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('room scope + member viewer → streams content', async () => {
      const { service, rooms } = makeService();
      rooms.allow(1, 42);
      const up = await service.upload({
        uploaderId: 42,
        scope: { roomId: 1 },
        filename: 'ok.txt',
        mime: 'text/plain',
        content: Buffer.from('payload'),
      });
      rooms.allow(1, 99);
      const { content, attachment } = await service.download(up.id, 99);
      expect(content.toString()).toBe('payload');
      expect(attachment.id).toBe(up.id);
    });

    it('room scope + non-member viewer → Forbidden', async () => {
      const { service, rooms } = makeService();
      rooms.allow(1, 42);
      const up = await service.upload({
        uploaderId: 42,
        scope: { roomId: 1 },
        filename: 'x.txt',
        mime: 'text/plain',
        content: Buffer.from('x'),
      });
      await expect(service.download(up.id, 500)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('dm scope + participant viewer → allowed', async () => {
      const { service, repo, storage } = makeService();
      const row = await repo.insertAttachment({
        id: 'a-dm',
        roomId: null,
        dmId: 9,
        uploaderId: 42,
        filename: 'd.bin',
        mime: 'application/octet-stream',
        sizeBytes: 5,
        path: '2026/04/a-dm_d.bin',
        comment: null,
        isImage: false,
      });
      storage.stored.set(row.path, Buffer.from('hello'));
      repo.dmParticipants.set(9, new Set([42, 7]));
      const { content } = await service.download('a-dm', 7);
      expect(content.toString()).toBe('hello');
    });

    it('dm scope + non-participant → Forbidden', async () => {
      const { service, repo } = makeService();
      await repo.insertAttachment({
        id: 'a-dm2',
        roomId: null,
        dmId: 9,
        uploaderId: 42,
        filename: 'd.bin',
        mime: 'application/octet-stream',
        sizeBytes: 5,
        path: '2026/04/a-dm2_d.bin',
        comment: null,
        isImage: false,
      });
      repo.dmParticipants.set(9, new Set([42, 7]));
      await expect(service.download('a-dm2', 99)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findByMessageId', () => {
    it('returns only rows with matching messageId', async () => {
      const { service, repo } = makeService();
      await repo.insertAttachment({
        id: 'a1',
        roomId: 1,
        dmId: null,
        uploaderId: 42,
        filename: 'a.txt',
        mime: 'text/plain',
        sizeBytes: 1,
        path: 'p',
        comment: null,
        isImage: false,
      });
      await repo.insertAttachment({
        id: 'a2',
        roomId: 1,
        dmId: null,
        uploaderId: 42,
        filename: 'b.txt',
        mime: 'text/plain',
        sizeBytes: 1,
        path: 'p2',
        comment: null,
        isImage: false,
      });
      repo.rows.get('a1')!.messageId = 7n;
      const found = await service.findByMessageId(7n);
      expect(found).toHaveLength(1);
      expect(found[0]!.id).toBe('a1');
    });
  });
});
