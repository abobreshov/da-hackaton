import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ErrorCode, WireError } from '@app/contracts';
import { MESSAGES_REPOSITORY, MessageRow, MessagesRepositoryPort } from './messages.types';
import { RoomsService } from '../rooms/rooms.service';
import {
  ATTACHMENTS_REPOSITORY,
  AttachmentRow,
  AttachmentsRepositoryPort,
} from '../attachments/attachments.types';
import { EVENT_PUBLISHER, IEventPublisher } from '../../common/events/event-publisher.interface';

/**
 * EPIC-09 event emitted by MessagesService after a successful insert.
 * Recipients of the 'unread.changed' WS broadcast are resolved by
 * `UnreadSubscriber` so the producer stays thin.
 *
 * For the DM path `peerUserId` is included directly — the subscriber must
 * not re-query the dm_channels row to find it, since that would couple the
 * unread module back to the messages repository.
 */
export type MessageCreatedEvent =
  | {
      scope: 'room';
      messageId: bigint;
      authorId: number;
      roomId: number;
    }
  | {
      scope: 'dm';
      messageId: bigint;
      authorId: number;
      dmId: number;
      peerUserId: number;
    };

export const MESSAGE_CREATED_EVENT = 'message.created';

/** AC-07-02 — body upper bound. 3 KiB of bytes / chars / whatever the spec
 *  says; we count string length here (UTF-16 code units) which is a tight
 *  upper bound on UTF-8 bytes for any realistic mix. */
export const MAX_BODY_LENGTH = 3 * 1024;

/** Hard cap on page size regardless of caller request — matches the spec's
 *  "infinite scroll in batches of 50" language. */
export const MAX_PAGE_LIMIT = 50;

export interface CreateMessageParams {
  authorId: number;
  roomId?: number;
  dmUserId?: number;
  body: string;
  replyToId?: bigint | null;
  /** Orphan attachment UUIDs to bind to the new message. Service enforces
   *  same uploader + same scope via the attachments repo. */
  attachmentIds?: string[];
}

export interface EditMessageParams {
  id: bigint;
  actorId: number;
  body: string;
}

export interface DeleteMessageParams {
  id: bigint;
  actorId: number;
  /** Caller asserts admin/owner role for the hosting room. Non-null only in
   *  the room-delete path; DM deletes are always author-only. */
  isRoomAdmin: boolean;
}

export interface ListMessagesParams {
  roomId?: number;
  dmId?: number;
  before?: { createdAt: Date; id: bigint };
  limit: number;
}

export interface SinceMessagesParams {
  roomId?: number;
  dmId?: number;
  lastSeenId: bigint;
  limit: number;
}

function wire(status: HttpStatus, code: ErrorCode, message: string): HttpException {
  const body: WireError = { code, message };
  return new HttpException(body, status);
}

/**
 * EPIC-07 domain service. Business rules live here; persistence goes through
 * the injected repository port so we can unit-test without Postgres. Room
 * membership is resolved via RoomsService.ensureMember — same ACL used by
 * the BFF before delivering `room.*` WS frames.
 */
@Injectable()
export class MessagesService {
  constructor(
    @Inject(MESSAGES_REPOSITORY)
    private readonly repo: MessagesRepositoryPort,
    private readonly rooms: RoomsService,
    @Inject(ATTACHMENTS_REPOSITORY)
    private readonly attachments: AttachmentsRepositoryPort,
    @Inject(EVENT_PUBLISHER)
    private readonly publisher: IEventPublisher,
  ) {}

  async create(
    params: CreateMessageParams,
  ): Promise<{ message: MessageRow; attachments: AttachmentRow[] }> {
    this.assertBody(params.body);

    const hasRoom = params.roomId != null;
    const hasDm = params.dmUserId != null;
    if (hasRoom === hasDm) {
      throw new BadRequestException('exactly one of roomId or dmUserId must be provided');
    }

    if (hasRoom) {
      await this.rooms.ensureMember({
        roomId: params.roomId as number,
        userId: params.authorId,
      });

      const row = await this.repo.insertMessage({
        roomId: params.roomId as number,
        dmId: null,
        authorId: params.authorId,
        body: params.body,
        replyTo: params.replyToId ?? null,
      });
      const bound = await this.bindAttachments(params.attachmentIds, {
        messageId: row.id,
        uploaderId: params.authorId,
        scope: { roomId: params.roomId as number },
      });
      this.publisher.emit(MESSAGE_CREATED_EVENT, {
        scope: 'room',
        messageId: row.id,
        authorId: params.authorId,
        roomId: params.roomId as number,
      } satisfies MessageCreatedEvent);
      return { message: row, attachments: bound };
    }

    // DM path
    if (params.dmUserId === params.authorId) {
      throw new BadRequestException('cannot DM yourself');
    }
    const channel = await this.repo.upsertDmChannel(params.authorId, params.dmUserId as number);
    const row = await this.repo.insertMessageIfDmNotFrozen({
      roomId: null,
      dmId: channel.id,
      authorId: params.authorId,
      body: params.body,
      replyTo: params.replyToId ?? null,
    });
    if (!row) {
      // AC-07-19 — atomic frozen guard: 0 rows → DM_FROZEN 403.
      throw wire(
        HttpStatus.FORBIDDEN,
        ErrorCode.DM_FROZEN,
        'DM is frozen; one side has banned the other',
      );
    }
    const bound = await this.bindAttachments(params.attachmentIds, {
      messageId: row.id,
      uploaderId: params.authorId,
      scope: { dmId: channel.id },
    });
    this.publisher.emit(MESSAGE_CREATED_EVENT, {
      scope: 'dm',
      messageId: row.id,
      authorId: params.authorId,
      dmId: channel.id,
      peerUserId: params.dmUserId as number,
    } satisfies MessageCreatedEvent);
    return { message: row, attachments: bound };
  }

  /** Bind orphan attachments to a freshly-inserted message. Returns []
   *  when caller passed no ids; otherwise delegates to attachments repo. */
  private async bindAttachments(
    ids: string[] | undefined,
    input: {
      messageId: bigint;
      uploaderId: number;
      scope: { roomId: number } | { dmId: number };
    },
  ): Promise<AttachmentRow[]> {
    if (!ids || ids.length === 0) return [];
    return this.attachments.bindAttachmentsToMessage({
      attachmentIds: ids,
      messageId: input.messageId,
      uploaderId: input.uploaderId,
      scope: input.scope,
    });
  }

  async edit(params: EditMessageParams): Promise<{ message: MessageRow }> {
    this.assertBody(params.body);

    const existing = await this.repo.findMessageById(params.id);
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`message ${params.id} not found`);
    }
    if (existing.authorId !== params.actorId) {
      throw new ForbiddenException('only the author can edit this message');
    }

    // AC-07-17 — no time window. Body + editedAt only.
    const updated = await this.repo.updateMessageBody(params.id, params.body);
    if (!updated) {
      // Racy soft-delete between SELECT and UPDATE.
      throw new NotFoundException(`message ${params.id} not found`);
    }
    return { message: updated };
  }

  async delete(params: DeleteMessageParams): Promise<void> {
    const existing = await this.repo.findMessageById(params.id);
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`message ${params.id} not found`);
    }
    if (existing.authorId !== params.actorId && !params.isRoomAdmin) {
      throw new ForbiddenException('only the author or a room admin can delete');
    }
    const row = await this.repo.softDeleteMessage(params.id);
    if (!row) {
      // Raced with another delete.
      throw new NotFoundException(`message ${params.id} not found`);
    }
  }

  async list(params: ListMessagesParams): Promise<{ messages: MessageRow[] }> {
    this.assertScope(params);
    const limit = clampLimit(params.limit);
    const rows = await this.repo.listMessages({
      roomId: params.roomId,
      dmId: params.dmId,
      before: params.before,
      limit,
    });
    return { messages: rows };
  }

  async since(params: SinceMessagesParams): Promise<{ messages: MessageRow[] }> {
    this.assertScope(params);
    const limit = clampLimit(params.limit);
    const rows = await this.repo.listMessagesSince({
      roomId: params.roomId,
      dmId: params.dmId,
      lastSeenId: params.lastSeenId,
      limit,
    });
    return { messages: rows };
  }

  async getById(id: bigint): Promise<{ message: MessageRow }> {
    const row = await this.repo.findMessageById(id);
    if (!row) throw new NotFoundException(`message ${id} not found`);
    return { message: row };
  }

  /**
   * Resolve a DM channel by user pair. Used by the HTTP DM-history endpoint
   * so the caller doesn't have to know the internal dm_id. Returns null
   * (channel hasn't been provisioned yet → empty history, not an error).
   */
  async resolveDmChannelId(userA: number, userB: number): Promise<number | null> {
    const ch = await this.repo.findDmChannel(userA, userB);
    return ch?.id ?? null;
  }

  /**
   * Resolve or lazily create a DM channel for a user pair. Used by the
   * attachment-upload path so the first interaction in a DM can already
   * bind the orphan attachment row to a real `dm_id`. Rejects self-DMs
   * with BadRequestException so the guard lives in one place.
   */
  async resolveOrCreateDmChannelId(userA: number, userB: number): Promise<{ dmId: number }> {
    if (userA === userB) {
      throw new BadRequestException('cannot resolve a DM channel with yourself');
    }
    const ch = await this.repo.upsertDmChannel(userA, userB);
    return { dmId: ch.id };
  }

  // ——— helpers ———

  private assertBody(body: string): void {
    if (!body || body.trim().length === 0) {
      throw new BadRequestException('body is required');
    }
    if (body.length > MAX_BODY_LENGTH) {
      throw new BadRequestException(`body exceeds ${MAX_BODY_LENGTH} character cap`);
    }
  }

  private assertScope(p: { roomId?: number; dmId?: number }): void {
    const hasRoom = p.roomId != null;
    const hasDm = p.dmId != null;
    if (hasRoom === hasDm) {
      throw new BadRequestException('exactly one of roomId or dmId must be provided');
    }
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return MAX_PAGE_LIMIT;
  return Math.min(Math.trunc(limit), MAX_PAGE_LIMIT);
}
