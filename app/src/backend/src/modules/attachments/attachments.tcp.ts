import { BadRequestException, Controller, Inject, NotFoundException } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { AttachmentsService } from './attachments.service';
import { ATTACHMENTS_REPOSITORY, AttachmentsRepositoryPort } from './attachments.types';

function assertScopeXor(scope: unknown): asserts scope is { roomId: number } | { dmId: number } {
  // TCP payloads are unvalidated; an attacker holding `_sys` could send
  // `{ roomId: 1, dmId: 2 }` and the service's `'roomId' in scope` branch
  // would silently persist the row with both columns set. Enforce XOR here
  // so the DB CHECK never has to carry the load alone.
  if (!scope || typeof scope !== 'object') {
    throw new BadRequestException('attachments.upload: scope is required');
  }
  const s = scope as { roomId?: unknown; dmId?: unknown };
  const hasRoom = typeof s.roomId === 'number' && Number.isFinite(s.roomId);
  const hasDm = typeof s.dmId === 'number' && Number.isFinite(s.dmId);
  if (hasRoom === hasDm) {
    throw new BadRequestException(
      'attachments.upload: exactly one of scope.roomId or scope.dmId must be set',
    );
  }
}

/**
 * TCP-facing controller for BFF -> backend attachments RPC (EPIC-08).
 *
 * Binary payloads travel as base64 strings on the wire; decoding happens
 * here so the service keeps a Buffer-only API. Exception translation is
 * global via `RpcExceptionFilter` — handlers just let HttpException bubble.
 */

interface UploadPayload {
  uploaderId: number;
  scope: { roomId: number } | { dmId: number };
  filename: string;
  mime: string;
  content: string; // base64
  comment?: string | null;
  _sys?: string;
}

interface DownloadPayload {
  attachmentId: string;
  viewerId: number;
  _sys?: string;
}

interface ListByMessagePayload {
  messageId: string; // bigint on the wire
  _sys?: string;
}

interface FindByIdPayload {
  id: string;
  _sys?: string;
}

@Controller()
export class AttachmentsTcpController {
  constructor(
    private readonly service: AttachmentsService,
    @Inject(ATTACHMENTS_REPOSITORY)
    private readonly repo: AttachmentsRepositoryPort,
  ) {}

  @MessagePattern({ cmd: TcpCmd.attachments.upload })
  async upload(@Payload() data: UploadPayload) {
    assertScopeXor(data.scope);
    const attachment = await this.service.upload({
      uploaderId: data.uploaderId,
      scope: data.scope,
      filename: data.filename,
      mime: data.mime,
      content: Buffer.from(data.content, 'base64'),
      comment: data.comment ?? null,
    });
    return { attachment };
  }

  @MessagePattern({ cmd: TcpCmd.attachments.download })
  async download(@Payload() data: DownloadPayload) {
    const { attachment, content } = await this.service.download(data.attachmentId, data.viewerId);
    return { attachment, content: content.toString('base64') };
  }

  @MessagePattern({ cmd: TcpCmd.attachments.listByMessage })
  async listByMessage(@Payload() data: ListByMessagePayload) {
    const attachments = await this.service.findByMessageId(BigInt(data.messageId));
    return { attachments };
  }

  @MessagePattern({ cmd: TcpCmd.attachments.findById })
  async findById(@Payload() data: FindByIdPayload) {
    const attachment = await this.repo.findById(data.id);
    if (!attachment) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'attachment not found',
      });
    }
    return { attachment };
  }
}
