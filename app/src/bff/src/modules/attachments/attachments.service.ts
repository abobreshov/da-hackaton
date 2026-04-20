import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';
import { BACKEND_SERVICE } from '../../common/microservice.module';

export interface UploadInput {
  uploaderId: number;
  scope: { roomId: number } | { dmId: number };
  filename: string;
  mime: string;
  content: Buffer;
  comment?: string | null;
}

export interface BffAttachment {
  id: string;
  roomId: number | null;
  dmId: number | null;
  messageId: string | null;
  uploaderId: number;
  filename: string;
  mime: string;
  sizeBytes: number;
  path: string;
  comment: string | null;
  isImage: boolean;
  createdAt: string | null;
}

@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(BACKEND_SERVICE) private readonly client: ClientProxy,
    private readonly proxy: RpcProxyService,
  ) {}

  async upload(input: UploadInput): Promise<{ attachment: BffAttachment }> {
    return this.proxy.forward(this.client, { cmd: TcpCmd.attachments.upload }, {
      uploaderId: input.uploaderId,
      scope: input.scope,
      filename: input.filename,
      mime: input.mime,
      content: input.content.toString('base64'),
      comment: input.comment ?? null,
    });
  }

  async download(attachmentId: string, viewerId: number): Promise<{
    attachment: BffAttachment;
    content: Buffer;
  }> {
    const { attachment, content } = await this.proxy.forward<
      { attachment: BffAttachment; content: string }
    >(this.client, { cmd: TcpCmd.attachments.download }, { attachmentId, viewerId });
    return { attachment, content: Buffer.from(content, 'base64') };
  }
}
