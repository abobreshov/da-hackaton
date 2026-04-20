import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import { Db } from '../../database/connection';
import { attachments, dmChannels } from '../../database/schema';
import {
  AttachmentRow,
  AttachmentsRepositoryPort,
  BindAttachmentsInput,
  CreateAttachmentInput,
} from './attachments.types';

/**
 * Drizzle adapter for AttachmentsRepositoryPort. Keeps `messageId` as native
 * bigint (schema uses `{ mode: 'bigint' }`). Path is stored as-returned by
 * the storage adapter — repo never touches the filesystem.
 */
@Injectable()
export class DrizzleAttachmentsRepository implements AttachmentsRepositoryPort {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  async insertAttachment(input: CreateAttachmentInput): Promise<AttachmentRow> {
    const rows = await (this.db as any)
      .insert(attachments)
      .values({
        id: input.id,
        roomId: input.roomId,
        dmId: input.dmId,
        uploaderId: input.uploaderId,
        filename: input.filename,
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        path: input.path,
        comment: input.comment,
        isImage: input.isImage,
      })
      .returning();
    return rows[0] as AttachmentRow;
  }

  async findById(id: string): Promise<AttachmentRow | null> {
    const rows = await (this.db as any)
      .select()
      .from(attachments)
      .where(eq(attachments.id, id))
      .limit(1);
    return (rows[0] as AttachmentRow) ?? null;
  }

  async findByMessageId(messageId: bigint): Promise<AttachmentRow[]> {
    const rows = await (this.db as any)
      .select()
      .from(attachments)
      .where(eq(attachments.messageId, messageId));
    return rows as AttachmentRow[];
  }

  async bindAttachmentsToMessage(input: BindAttachmentsInput): Promise<AttachmentRow[]> {
    if (input.attachmentIds.length === 0) return [];
    const scopeFilter =
      'roomId' in input.scope
        ? eq(attachments.roomId, input.scope.roomId)
        : eq(attachments.dmId, input.scope.dmId);

    const rows = await (this.db as any)
      .update(attachments)
      .set({ messageId: input.messageId })
      .where(
        and(
          inArray(attachments.id, input.attachmentIds),
          eq(attachments.uploaderId, input.uploaderId),
          isNull(attachments.messageId),
          scopeFilter,
        ),
      )
      .returning();
    return rows as AttachmentRow[];
  }

  async isDmParticipant(dmId: number, userId: number): Promise<boolean> {
    const rows = await (this.db as any)
      .select({ userLow: dmChannels.userLow, userHigh: dmChannels.userHigh })
      .from(dmChannels)
      .where(
        and(
          eq(dmChannels.id, dmId),
          or(eq(dmChannels.userLow, userId), eq(dmChannels.userHigh, userId)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
