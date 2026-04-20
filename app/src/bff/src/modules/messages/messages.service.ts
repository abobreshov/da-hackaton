import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { TcpCmd } from '@app/contracts';
import { BACKEND_SERVICE } from '../../common/microservice.module';
import { RpcProxyService } from '../../common/proxy/rpc-proxy.service';

export interface CreateMessageInput {
  authorId: number;
  /** Target room. XOR with {@link dmUserId}. */
  roomId?: number;
  /** Target DM peer. XOR with {@link roomId}. */
  dmUserId?: number;
  body: string;
  /** Parent message id, bigint as decimal string. */
  replyToId?: string;
}

export interface ListMessagesInput {
  roomId?: number;
  dmUserId?: number;
  /** ISO-8601 timestamp (oldest already-seen message). */
  beforeCreatedAt?: string;
  /** BigInt message id (decimal string). */
  beforeId?: string;
  limit: number;
}

export interface SinceMessagesInput {
  roomId?: number;
  dmUserId?: number;
  sinceCreatedAt: string;
  sinceId: string;
  limit: number;
}

export interface EditMessageInput {
  messageId: string;
  actorId: number;
  body: string;
}

export interface DeleteMessageInput {
  messageId: string;
  actorId: number;
}

export interface GetMessageByIdInput {
  messageId: string;
  actorId: number;
}

/**
 * Thin BFF proxy for the backend's messages module. Every method delegates
 * straight to {@link RpcProxyService.forward} which owns the `_sys` envelope,
 * upstream timeout, and RxJS→Promise glue. Authorship / membership checks
 * live on the backend.
 */
@Injectable()
export class MessagesService {
  constructor(
    @Inject(BACKEND_SERVICE) private readonly client: ClientProxy,
    private readonly proxy: RpcProxyService,
  ) {}

  create(input: CreateMessageInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.messages.create }, { ...input });
  }

  list(input: ListMessagesInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.messages.list }, { ...input });
  }

  since(input: SinceMessagesInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.messages.since }, { ...input });
  }

  edit(input: EditMessageInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.messages.edit }, { ...input });
  }

  delete(input: DeleteMessageInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.messages.delete }, { ...input });
  }

  getById(input: GetMessageByIdInput) {
    return this.proxy.forward(this.client, { cmd: TcpCmd.messages.getById }, { ...input });
  }
}
