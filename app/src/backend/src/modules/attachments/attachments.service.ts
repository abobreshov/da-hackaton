import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ATTACHMENTS_REPOSITORY,
  AttachmentRow,
  AttachmentsRepositoryPort,
  CreateAttachmentInput,
} from './attachments.types';
import { AttachmentStoragePort, ATTACHMENT_STORAGE } from './storage/attachment-storage.types';
import { RoomsService } from '../rooms/rooms.service';

/** 20 MiB general cap; 3 MiB cap on images. Mirrors §3.4 + AC-08-05. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const IMAGE_MIME_PREFIX = 'image/';

/** Magic-byte signatures for images. Security (Vuln 2): client-claimed MIME
 *  is untrusted — if payload starts w/ a known image signature, enforce the
 *  tighter 3 MiB cap regardless of the declared content type. */
function sniffIsImage(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return true;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // GIF87a / GIF89a: 47 49 46 38 {37|39} 61
  if (
    buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61
  ) return true;
  // WEBP: RIFF....WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return true;
  // BMP: 42 4D
  if (buf[0] === 0x42 && buf[1] === 0x4d) return true;
  return false;
}

export interface UploadAttachmentInput {
  uploaderId: number;
  scope: { roomId: number } | { dmId: number };
  filename: string;
  mime: string;
  content: Buffer;
  comment?: string | null;
}

@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(ATTACHMENTS_REPOSITORY)
    private readonly repo: AttachmentsRepositoryPort,
    @Inject(ATTACHMENT_STORAGE)
    private readonly storage: AttachmentStoragePort,
    private readonly rooms: RoomsService,
  ) {}

  /**
   * Upload + persist DB row. Does NOT yet bind to a message — the returned
   * id goes into `messages.create { attachmentIds }` (bind-on-send).
   *
   * Size gates:
   *  - image mime ⇒ ≤ MAX_IMAGE_BYTES else 413
   *  - any other ⇒ ≤ MAX_FILE_BYTES else 413
   */
  async upload(input: UploadAttachmentInput): Promise<AttachmentRow> {
    const size = input.content.byteLength;
    // Security (Vuln 2): server-side image detection via magic bytes — client
    // MIME is untrusted. If either declared type OR sniff says image, the
    // tighter 3 MiB cap applies.
    const claimedImage = input.mime.startsWith(IMAGE_MIME_PREFIX);
    const sniffedImage = sniffIsImage(input.content);
    const isImage = claimedImage || sniffedImage;

    if (isImage && size > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeException({
        code: 'VALIDATION_FAILED',
        message: `image exceeds ${MAX_IMAGE_BYTES} bytes`,
      });
    }
    if (!isImage && size > MAX_FILE_BYTES) {
      throw new PayloadTooLargeException({
        code: 'VALIDATION_FAILED',
        message: `file exceeds ${MAX_FILE_BYTES} bytes`,
      });
    }
    if (size === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'empty file',
      });
    }
    if (!input.filename || input.filename.length > 255) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'invalid filename',
      });
    }

    if ('roomId' in input.scope) {
      await this.rooms.ensureMember({
        roomId: input.scope.roomId,
        userId: input.uploaderId,
      });
    } else {
      // Security (Vuln 5): DM-scope upload MUST verify uploader is a
      // participant in the target dm_channel. Previously deferred to
      // message.create, but the orphan attachment persists in the victim's
      // channel row regardless of whether binding succeeds. Enforce up-front.
      const ok = await this.repo.isDmParticipant(input.scope.dmId, input.uploaderId);
      if (!ok) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'not a participant of this dm channel',
        });
      }
    }

    const id = randomUUID();
    const path = await this.storage.write({
      id,
      filename: input.filename,
      content: input.content,
    });

    const persisted: CreateAttachmentInput = {
      id,
      roomId: 'roomId' in input.scope ? input.scope.roomId : null,
      dmId: 'dmId' in input.scope ? input.scope.dmId : null,
      uploaderId: input.uploaderId,
      filename: input.filename,
      mime: input.mime,
      sizeBytes: size,
      path,
      comment: input.comment ?? null,
      isImage,
    };

    return this.repo.insertAttachment(persisted);
  }

  /**
   * AC-08-06/07 — download ACL check: caller must be a current member of
   * the room (or participant in the DM channel). Uploader-who-left retains
   * the row per AC-08-08 but cannot fetch.
   */
  async download(attachmentId: string, viewerId: number): Promise<{
    attachment: AttachmentRow;
    content: Buffer;
  }> {
    const row = await this.repo.findById(attachmentId);
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'attachment not found',
      });
    }

    if (row.roomId !== null) {
      try {
        await this.rooms.ensureMember({
          roomId: row.roomId,
          userId: viewerId,
        });
      } catch {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'no access to this attachment',
        });
      }
    } else if (row.dmId !== null) {
      const ok = await this.repo.isDmParticipant(row.dmId, viewerId);
      if (!ok) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'no access to this attachment',
        });
      }
    }

    const content = await this.storage.read(row.path);
    return { attachment: row, content };
  }

  async findByMessageId(messageId: bigint): Promise<AttachmentRow[]> {
    return this.repo.findByMessageId(messageId);
  }
}
