import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SessionGuard } from '../../auth/session.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { AttachmentsService } from './attachments.service';

/**
 * Multipart field shape: one or more `file` parts + optional `comment` text
 * field. `@fastify/multipart` hard-caps at 20 MiB per file (main.ts);
 * backend re-enforces 3 MiB for images via magic-byte sniff.
 *
 * Security (Vuln 3 + Vuln 4):
 *  - RFC 5987 filename*= on Content-Disposition so names with special chars
 *    can't split the header or inject attributes.
 *  - Forced `Content-Type: application/octet-stream` on download so a
 *    malicious uploaded HTML/SVG can't execute in the viewer's origin.
 *  - `X-Content-Type-Options: nosniff` blocks the browser's MIME sniff
 *    fallback from negating the octet-stream decision.
 */
@Controller()
@UseGuards(SessionGuard)
export class AttachmentsController {
  constructor(private readonly service: AttachmentsService) {}

  @Post('rooms/:id/attachments')
  async uploadToRoom(
    @Param('id', ParseIntPipe) roomId: number,
    @Req() req: FastifyRequest,
    @CurrentUserId() userId: number,
  ) {
    const parts = (req as any).parts?.() as AsyncIterable<any> | undefined;
    if (!parts) throw new BadRequestException('multipart body required');
    return this.collectAndUpload(parts, userId, { roomId });
  }

  @Post('dms/:userId/attachments')
  async uploadToDm(
    @Param('userId', ParseIntPipe) otherUserId: number,
    @Req() req: FastifyRequest,
    @CurrentUserId() userId: number,
  ) {
    // NOTE: dmId resolution happens at backend side in a future iteration —
    // for MVP the FE sends via `/rooms/:id/attachments` after the DM channel
    // is established OR we accept a dmId directly. Expose as `dms/:userId`
    // and let backend resolve via TcpCmd.messages.resolveDm (falls back to
    // upsert at message.create time). Interim: bubble a 400 if no dmId
    // on parts.
    const parts = (req as any).parts?.() as AsyncIterable<any> | undefined;
    if (!parts) throw new BadRequestException('multipart body required');
    // For now the FE is expected to pass `dmId` field. Long-term, BFF
    // resolves via backend TCP — track as TODO.
    let dmId: number | null = null;
    const fileBufs: Array<{ filename: string; mime: string; content: Buffer; comment: string | null }> = [];
    for await (const part of parts) {
      if (part.type === 'file') {
        const bufs: Buffer[] = [];
        for await (const chunk of part.file) bufs.push(chunk as Buffer);
        fileBufs.push({
          filename: String(part.filename ?? 'file'),
          mime: String(part.mimetype ?? 'application/octet-stream'),
          content: Buffer.concat(bufs),
          comment: null,
        });
      } else if (part.type === 'field') {
        if (part.fieldname === 'dmId') dmId = Number.parseInt(String(part.value ?? ''), 10);
        if (part.fieldname === 'comment' && fileBufs.length > 0) {
          fileBufs[fileBufs.length - 1]!.comment = String(part.value ?? '').slice(0, 500);
        }
      }
    }
    if (!dmId || Number.isNaN(dmId)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'missing dmId field (other user: ' + otherUserId + ')',
      });
    }

    const uploaded: unknown[] = [];
    for (const f of fileBufs) {
      uploaded.push(
        (await this.service.upload({
          uploaderId: userId,
          scope: { dmId },
          filename: f.filename,
          mime: f.mime,
          content: f.content,
          comment: f.comment,
        })).attachment,
      );
    }
    return { attachments: uploaded };
  }

  @Get('attachments/:id/download')
  async download(
    @Param('id') attachmentId: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
    @CurrentUserId() userId: number,
  ): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) {
      throw new BadRequestException('invalid attachment id');
    }

    const { attachment, content } = await this.service.download(attachmentId, userId);
    const safeName = sanitizeHeaderFilename(attachment.filename);
    const rfc5987 = encodeRfc5987(attachment.filename);

    reply.header('Content-Type', 'application/octet-stream');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Length', String(content.byteLength));
    reply.header(
      'Content-Disposition',
      `attachment; filename="${safeName}"; filename*=UTF-8''${rfc5987}`,
    );
    reply.send(content);
  }

  private async collectAndUpload(
    parts: AsyncIterable<any>,
    userId: number,
    scope: { roomId: number } | { dmId: number },
  ) {
    const files: Array<{ filename: string; mime: string; content: Buffer; comment: string | null }> = [];
    let lastComment: string | null = null;
    for await (const part of parts) {
      if (part.type === 'file') {
        const bufs: Buffer[] = [];
        for await (const chunk of part.file) bufs.push(chunk as Buffer);
        files.push({
          filename: String(part.filename ?? 'file'),
          mime: String(part.mimetype ?? 'application/octet-stream'),
          content: Buffer.concat(bufs),
          comment: lastComment,
        });
      } else if (part.type === 'field' && part.fieldname === 'comment') {
        lastComment = String(part.value ?? '').slice(0, 500);
      }
    }
    if (files.length === 0) throw new BadRequestException('no files in body');
    const uploaded: unknown[] = [];
    for (const f of files) {
      uploaded.push((await this.service.upload({
        uploaderId: userId,
        scope,
        filename: f.filename,
        mime: f.mime,
        content: f.content,
        comment: f.comment,
      })).attachment);
    }
    return { attachments: uploaded };
  }
}

/** Strip CR/LF/NUL/quote from filename before embedding in the quoted-string
 *  portion of Content-Disposition. See Vuln 3 in security-review notes. */
function sanitizeHeaderFilename(raw: string): string {
  return raw
    .replace(/[\r\n\0"\\]/g, '_')
    .slice(0, 200) || 'file';
}

/** RFC 5987 encoded filename for the `filename*=` parameter. */
function encodeRfc5987(raw: string): string {
  return encodeURIComponent(raw).replace(/['()]/g, escape).replace(/\*/g, '%2A');
}
