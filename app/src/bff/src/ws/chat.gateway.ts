import { Inject, Injectable, Logger, OnModuleInit, UseGuards } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ErrorCode, RedisChannel, TcpCmd, WireError, WsEvent } from '@app/contracts';
import { AUTH_SERVICE, BACKEND_SERVICE } from '../common/microservice.module';
import { RpcProxyService } from '../common/proxy/rpc-proxy.service';
import { WsOriginGuard } from './origin.guard';
import { RedisSubscriberService } from './redis-subscriber.service';
import { WsAuthenticator } from './ws-authenticator.service';
import { WsConnectRateLimit } from './ws-connect-rate-limit.service';

/**
 * EPIC-03 WS gateway.
 *
 * Connection lifecycle:
 *   1. Origin allow-list via WsOriginGuard (close code 4403).
 *   2. Cookie-only session extraction via {@link WsAuthenticator} (AC-03-10).
 *   3. Register with subscriber for presence fan-out; subscribe `user:{id}`
 *      so server-pushed per-user events land on the right socket.
 *
 * Message fan-out:
 *   - Socket.IO room broadcast via `this.server.to(`room:{id}`).emit(...)`.
 *     The @socket.io/redis-adapter transparently replicates room emits
 *     across BFF replicas, so no custom `SUBSCRIBE room:{id}` is needed.
 *   - DM fan-out uses `dm:{dmId}` rooms; the sender socket auto-joins
 *     the DM room on first send, and `dm.frozen` events evict members.
 *
 * Handlers are defensive: unauthenticated sockets get `{ ok: false }` acks
 * rather than throwing, because Socket.IO turns exceptions into anonymous
 * `error` emits which are harder to diagnose from the FE.
 */
@Injectable()
@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3007').split(','),
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly authenticator: WsAuthenticator,
    @Inject(AUTH_SERVICE) private readonly auth: ClientProxy,
    @Inject(BACKEND_SERVICE) private readonly backend: ClientProxy,
    private readonly subscriber: RedisSubscriberService,
    private readonly originGuard: WsOriginGuard,
    private readonly proxy: RpcProxyService,
    private readonly connectLimiter: WsConnectRateLimit,
  ) {}

  onModuleInit(): void {
    // The origin guard is enforced in handleConnection directly (not via
    // @UseGuards) because gateway-level guards don't run on the raw upgrade
    // in every Nest version — we want deterministic 4403.
  }

  // -------------------------------------------------------------- connect
  async handleConnection(client: Socket): Promise<void> {
    // 1. Origin check (4403)
    const originOk = this.originGuard.canActivate({
      switchToWs: () => ({ getClient: () => client }),
    } as any);
    if (!originOk) {
      // Guard already disconnected + emitted 'error' with 4403.
      return;
    }

    // 2. Cookie → session, delegated.
    const identity = this.authenticator.authenticate(client);
    if (!identity) {
      this.reject(client, 4401, 'Unauthenticated');
      return;
    }

    // 3. Per-user connect rate-limit (AC-14-12, 10/60 s). Runs BEFORE
    // subscriber bookkeeping so a rejected socket never gets registered.
    const limit = await this.connectLimiter.check(identity.userId);
    if (!limit.ok) {
      this.rejectRateLimited(client, limit.retryAfterMs);
      return;
    }

    // 4. Attach identity + register in the subscriber's interest graph.
    client.data.userId = identity.userId;
    client.data.sessionId = identity.sessionId;
    this.subscriber.registerSocket(client as any);
    // Every authenticated socket cares about its own user channel
    // (for server-pushed events addressed to that user).
    try {
      await this.subscriber.subscribeFor(client.id, RedisChannel.user(identity.userId));
    } catch (e) {
      this.logger.error(`user-channel subscribe failed: ${(e as Error).message}`);
    }
  }

  private reject(client: Socket, code: number, message: string): void {
    try {
      client.emit(WsEvent.server.error ?? 'error', { code, message });
    } catch {
      /* noop */
    }
    try {
      client.disconnect(true);
    } catch {
      /* noop */
    }
  }

  /**
   * AC-14-12 — connect rate-limit reject. Emits a wire-friendly
   * {@link WireError} (code: RATE_LIMITED, retryAfterMs) and disconnects.
   * The WS close code 4429 is the application-range analog of HTTP 429.
   */
  private rejectRateLimited(client: Socket, retryAfterMs?: number): void {
    const body: WireError = {
      code: ErrorCode.RATE_LIMITED,
      message: 'Too many WS connections',
      retryAfterMs,
      details: { scope: 'wsconn', closeCode: 4429 },
    };
    try {
      client.emit(WsEvent.server.error ?? 'error', body);
    } catch {
      /* noop */
    }
    try {
      client.disconnect(true);
    } catch {
      /* noop */
    }
  }

  // ----------------------------------------------------------- disconnect
  async handleDisconnect(client: Socket): Promise<void> {
    const userId = client.data?.userId as number | undefined;
    const sessionId = client.data?.sessionId as string | undefined;
    this.subscriber.unregisterSocket(client.id);
    if (!userId) return;
    try {
      await this.proxy.forward(
        this.backend,
        { cmd: TcpCmd.presence.disconnect },
        { userId, sessionId: sessionId ?? client.id },
      );
    } catch (e) {
      this.logger.warn(`presence.disconnect failed: ${(e as Error).message}`);
    }
  }

  // --------------------------------------------------------- room.join
  @UseGuards(WsOriginGuard)
  @SubscribeMessage(WsEvent.client.roomJoin)
  async onRoomJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: number },
  ): Promise<{ ok: boolean; roomId?: number; members?: any[]; error?: string }> {
    const userId = client.data?.userId as number | undefined;
    if (!userId) return { ok: false, error: 'unauthenticated' };
    const roomId = Number(body?.roomId);
    if (!Number.isFinite(roomId)) return { ok: false, error: 'invalid roomId' };

    try {
      await this.proxy.forward(
        this.backend,
        { cmd: TcpCmd.rooms.ensureMember },
        { userId, roomId },
      );
      const members = await this.proxy.forward<any[]>(
        this.backend,
        { cmd: TcpCmd.rooms.membersOf },
        { roomId },
      );
      // Socket.IO room join — redis-adapter replicates cross-replica.
      // NOTE: no custom redis SUBSCRIBE for `room:{id}` messages — the
      // adapter already handles it and double-subscribing wastes connections.
      client.join(RedisChannel.room(roomId));
      return { ok: true, roomId, members: members ?? [] };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'room.join failed' };
    }
  }

  // -------------------------------------------------------- room.leave
  @UseGuards(WsOriginGuard)
  @SubscribeMessage(WsEvent.client.roomLeave)
  async onRoomLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: number },
  ): Promise<{ ok: boolean }> {
    const userId = client.data?.userId as number | undefined;
    if (!userId) return { ok: false };
    const roomId = Number(body?.roomId);
    if (!Number.isFinite(roomId)) return { ok: false };
    client.leave(RedisChannel.room(roomId));
    return { ok: true };
  }

  // ----------------------------------------------------- presence.ping
  @UseGuards(WsOriginGuard)
  @SubscribeMessage(WsEvent.client.presencePing)
  async onPresencePing(@ConnectedSocket() client: Socket): Promise<{ ok: boolean }> {
    const userId = client.data?.userId as number | undefined;
    const sessionId = client.data?.sessionId as string | undefined;
    if (!userId) return { ok: false };
    try {
      await this.proxy.forward(
        this.backend,
        { cmd: TcpCmd.presence.touch },
        { userId, sessionId: sessionId ?? client.id },
      );
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  // ------------------------------------------------------ message.send
  @UseGuards(WsOriginGuard)
  @SubscribeMessage(WsEvent.client.messageSend)
  async onMessageSend(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      roomId?: number;
      dmUserId?: number;
      body: string;
      replyToId?: number;
      attachmentIds?: string[];
    },
  ): Promise<{ ok: boolean; message?: any; attachments?: unknown[]; error?: unknown }> {
    const userId = client.data?.userId as number | undefined;
    if (!userId) return { ok: false, error: 'unauthenticated' };

    try {
      const payload: Record<string, unknown> = {
        authorId: userId,
        body: body.body,
      };
      if (body.roomId !== undefined) payload.roomId = body.roomId;
      if (body.dmUserId !== undefined) payload.dmUserId = body.dmUserId;
      if (body.replyToId !== undefined) payload.replyToId = body.replyToId;
      if (body.attachmentIds && body.attachmentIds.length > 0) {
        payload.attachmentIds = body.attachmentIds;
      }

      const result = await this.proxy.forward<any>(
        this.backend,
        { cmd: TcpCmd.messages.create },
        payload,
      );

      // Backend returns `{message, attachments}` since EPIC-08. Tolerate
      // both shapes so legacy callers / mocks still work.
      const message = result?.message ?? result;
      const attachments = Array.isArray(result?.attachments) ? result.attachments : [];

      const target = this.broadcastTarget(message);
      if (target.kind === 'dm') {
        // Ensure sender is joined to the DM socket.io room so future
        // broadcasts land on them (first-message-ever path).
        try {
          client.join(target.room);
        } catch {
          /* noop — non-fatal */
        }
      }
      this.server.to(target.room).emit(WsEvent.server.messageNew, { message, attachments });
      return { ok: true, message, attachments };
    } catch (e: any) {
      return { ok: false, error: this.wireError(e) };
    }
  }

  // ------------------------------------------------------ message.edit
  @UseGuards(WsOriginGuard)
  @SubscribeMessage(WsEvent.client.messageEdit)
  async onMessageEdit(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { id: number; body: string },
  ): Promise<{ ok: boolean; message?: any; error?: unknown }> {
    const userId = client.data?.userId as number | undefined;
    if (!userId) return { ok: false, error: 'unauthenticated' };

    try {
      const message = await this.proxy.forward<any>(
        this.backend,
        { cmd: TcpCmd.messages.edit },
        { editorId: userId, id: body.id, body: body.body },
      );
      const target = this.broadcastTarget(message);
      this.server.to(target.room).emit(WsEvent.server.messageEdited, { message });
      return { ok: true, message };
    } catch (e: any) {
      return { ok: false, error: this.wireError(e) };
    }
  }

  // ---------------------------------------------------- message.delete
  @UseGuards(WsOriginGuard)
  @SubscribeMessage(WsEvent.client.messageDelete)
  async onMessageDelete(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { id: number },
  ): Promise<{ ok: boolean; error?: unknown }> {
    const userId = client.data?.userId as number | undefined;
    if (!userId) return { ok: false, error: 'unauthenticated' };

    try {
      const result = await this.proxy.forward<{
        id: number;
        roomId?: number;
        dmId?: number;
      }>(this.backend, { cmd: TcpCmd.messages.delete }, { actorId: userId, id: body.id });
      const target = this.broadcastTarget(result);
      this.server.to(target.room).emit(WsEvent.server.messageDeleted, result);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: this.wireError(e) };
    }
  }

  // -------------------------------------------------------- sync.since
  @UseGuards(WsOriginGuard)
  @SubscribeMessage(WsEvent.client.syncSince)
  async onSyncSince(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { roomId?: number; dmUserId?: number; lastSeenId: number },
  ): Promise<{ ok: boolean; messages?: any[]; error?: unknown }> {
    const userId = client.data?.userId as number | undefined;
    if (!userId) return { ok: false, error: 'unauthenticated' };

    try {
      const payload: Record<string, unknown> = {
        userId,
        lastSeenId: body.lastSeenId,
      };
      if (body.roomId !== undefined) payload.roomId = body.roomId;
      if (body.dmUserId !== undefined) payload.dmUserId = body.dmUserId;

      const messages = await this.proxy.forward<any[]>(
        this.backend,
        { cmd: TcpCmd.messages.since },
        payload,
      );
      return { ok: true, messages };
    } catch (e: any) {
      return { ok: false, error: this.wireError(e) };
    }
  }

  /**
   * Hook for dm.frozen events — evicts every socket from `dm:{id}` and
   * pushes an `error` frame with `code: 'DM_FROZEN'` so the FE can drop
   * the open DM surface without re-polling. Called by the transport layer
   * once a publisher on the backend publishes the freeze event.
   */
  async onDmFrozen(dmId: number | string): Promise<void> {
    const room = RedisChannel.dm(dmId);
    try {
      this.server.to(room).emit(WsEvent.server.error ?? 'error', {
        code: 'DM_FROZEN',
        dmId,
        message: 'DM frozen',
      });
    } catch {
      /* noop — emit is best-effort */
    }
    try {
      // socket.io v4 ServerSideEmits: `in(room).socketsLeave(room)` removes
      // every socket in that room from the room, without disconnecting the
      // underlying transport.
      (this.server.in(room) as any).socketsLeave(room);
    } catch {
      /* noop */
    }
  }

  // --- helpers ----------------------------------------------------------

  /**
   * Resolve the Socket.IO room that should receive a message-mutation
   * broadcast. Prefers `dmId` when present (DM), falls back to `roomId`.
   * Returns both the kind (so the caller can decide whether to auto-join)
   * and the concrete room string.
   */
  private broadcastTarget(
    message: { roomId?: number | string; dmId?: number | string } | null | undefined,
  ): { kind: 'room' | 'dm'; room: string } {
    if (message?.dmId !== undefined && message.dmId !== null) {
      return { kind: 'dm', room: RedisChannel.dm(message.dmId) };
    }
    if (message?.roomId !== undefined && message.roomId !== null) {
      return { kind: 'room', room: RedisChannel.room(message.roomId) };
    }
    // Defensive: if the upstream response omitted both, fall back to a
    // private channel nobody is subscribed to (no broadcast leak).
    return { kind: 'room', room: RedisChannel.room('orphan') };
  }

  /**
   * Convert upstream errors (RpcException shapes, plain Error) into a
   * wire-friendly form the FE can introspect without leaking stack traces.
   */
  private wireError(e: any): { status?: number; code?: string; message?: string } {
    if (!e) return { message: 'unknown' };
    if (typeof e === 'object') {
      const err = typeof e.getError === 'function' ? e.getError() : e;
      return {
        status: err?.status,
        code: err?.code,
        message: err?.message ?? (typeof err === 'string' ? err : undefined),
      };
    }
    return { message: String(e) };
  }
}
