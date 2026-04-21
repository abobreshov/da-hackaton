import { Inject, Injectable, Logger, OnModuleInit, UseGuards } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ErrorCode, RedisChannel, TcpCmd, WireError, WsEvent } from '@app/contracts';
import { AUTH_SERVICE, BACKEND_SERVICE } from '../common/microservice.module';
import { resolveAllowedWsOrigins } from '../config/environment';
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
    // Single source of truth — see {@link resolveAllowedWsOrigins} doc-comment.
    // WsOriginGuard reads the same resolver, so the upgrade-time CORS check
    // and per-event guard cannot disagree (the bug that caused "WS connects
    // then dies on first room.join").
    origin: resolveAllowedWsOrigins(),
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, OnModuleInit
{
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

  /**
   * Socket.IO server middleware — runs BEFORE the namespace fires
   * `connection`, so it's the only place we can authenticate the socket
   * synchronously enough to guarantee `client.data.userId` is set before
   * any event handler can dispatch. Without this, a client that emits
   * `room.join` immediately on connect can race the async work in
   * `handleConnection` (rate-limit + redis subscribe) and hit the
   * "unauthenticated" guard inside the message handler.
   */
  afterInit(server: Server): void {
    server.use((client, next) => {
      // 1. Origin check
      const originOk = this.originGuard.canActivate({
        switchToWs: () => ({ getClient: () => client }),
      } as any);
      if (!originOk) {
        return next(new Error('Origin not allowed'));
      }
      // 2. Cookie → session
      const identity = this.authenticator.authenticate(client as any);
      if (!identity) {
        return next(new Error('Unauthenticated'));
      }
      client.data.userId = identity.userId;
      client.data.sessionId = identity.sessionId;
      next();
    });
  }

  // -------------------------------------------------------------- connect
  async handleConnection(client: Socket): Promise<void> {
    // Identity already set by the middleware. We only need to do the
    // book-keeping that's safe to run async (rate-limit + redis subscribe)
    // — message handlers can dispatch in parallel without seeing
    // `userId === undefined`.
    const userId = client.data.userId as number | undefined;
    const sessionId = client.data.sessionId as string | undefined;
    if (!userId || !sessionId) {
      // Should be unreachable (middleware refused the handshake) but bail
      // safely if a future refactor breaks the invariant.
      this.reject(client, 4401, 'Unauthenticated');
      return;
    }

    // Per-user connect rate-limit (AC-14-12, 10/60 s).
    const limit = await this.connectLimiter.check(userId);
    if (!limit.ok) {
      this.rejectRateLimited(client, limit.retryAfterMs);
      return;
    }

    this.subscriber.registerSocket(client as any);
    try {
      await this.subscriber.subscribeFor(client.id, RedisChannel.user(userId));
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
  ): Promise<{
    ok: boolean;
    roomId?: number;
    room?: { id: number; name: string; description: string | null };
    members?: any[];
    error?: string | { status?: number; code?: string; message?: string };
  }> {
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
      // membersOf returns the {members:[…]} envelope — unwrap it so the FE
      // gets a flat array (it iterates `ack.members` directly).
      const membersResp = await this.proxy.forward<{ members: any[] } | any[]>(
        this.backend,
        { cmd: TcpCmd.rooms.membersOf },
        { roomId },
      );
      const members = Array.isArray(membersResp)
        ? membersResp
        : Array.isArray(membersResp?.members)
          ? membersResp.members
          : [];

      // Look up the room row so the FE can render the header (name +
      // description). No dedicated rooms.findById TCP exists yet, so we
      // pluck from the catalog. Cheap until the catalog grows past a few
      // hundred rooms — at which point a dedicated TCP is the right fix.
      let roomMeta: { id: number; name: string; description: string | null } | undefined;
      try {
        const catalog = await this.proxy.forward<
          Array<{ id: number; name: string; description: string | null }>
        >(this.backend, { cmd: TcpCmd.rooms.catalog }, {});
        const found = Array.isArray(catalog) ? catalog.find((r) => r?.id === roomId) : undefined;
        if (found) {
          roomMeta = {
            id: found.id,
            name: found.name,
            description: found.description ?? null,
          };
        }
      } catch (lookupErr) {
        this.logger.warn(`room.join: catalog lookup failed: ${(lookupErr as Error).message}`);
      }
      // Defensive fallback — if catalog lookup miss/fail, give the FE a
      // minimal placeholder so the page renders instead of erroring.
      if (!roomMeta) {
        roomMeta = { id: roomId, name: `Room #${roomId}`, description: null };
      }

      // Socket.IO room join — redis-adapter replicates cross-replica.
      client.join(RedisChannel.room(roomId));
      return { ok: true, roomId, room: roomMeta, members };
    } catch (e: any) {
      // RpcException stores the structured payload under `getError()`.
      // Reading `e.message` alone yields the wrapper's default
      // 'Internal server error' string — losing the real upstream code +
      // message that the FE auto-join sniff (and error panel) need.
      return { ok: false, error: this.wireError(e) };
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

  // ------------------------------------------------- presence.subscribe
  /**
   * Register the caller's presence-interest set. Client emits this with the
   * list of userIds it currently renders (friends + room members etc.) so
   * `RedisSubscriberService.fanoutPresence` knows which deltas to forward
   * back over the socket. Idempotent — re-emitting unions with the existing
   * set rather than replacing it.
   */
  @UseGuards(WsOriginGuard)
  @SubscribeMessage(WsEvent.client.presenceSubscribe)
  async onPresenceSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { userIds?: Array<number | string> },
  ): Promise<{ ok: boolean }> {
    const userId = client.data?.userId as number | undefined;
    if (!userId) return { ok: false };
    const ids = Array.isArray(body?.userIds) ? body.userIds : [];
    if (ids.length === 0) return { ok: true };
    await this.subscriber.watchPresenceOf(client.id, ids);
    return { ok: true };
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
      if (!target) {
        // Malformed upstream — already logged. Still ack the sender so the
        // FE clears its composer, but skip fan-out.
        return { ok: true, message, attachments };
      }
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
      // Backend `MessagesTcpController.edit` reads `actorId` from the payload
      // (`messages.service.ts:223` checks `existing.authorId !== params.actorId`).
      // Sending `editorId` left actorId as undefined which always failed the
      // ownership check — so every WS edit returned "only the author can edit
      // this message" even for the message's real author.
      const result = await this.proxy.forward<any>(
        this.backend,
        { cmd: TcpCmd.messages.edit },
        { actorId: userId, id: body.id, body: body.body },
      );
      // Backend returns `{ message: MessageRow }` — unwrap so `target` and the
      // FE both see a flat MessageRow (matches `message.send`'s shape).
      const message = result?.message ?? result;
      const target = this.broadcastTarget(message);
      if (target) {
        this.server.to(target.room).emit(WsEvent.server.messageEdited, { message });
      }
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
      if (target) {
        this.server.to(target.room).emit(WsEvent.server.messageDeleted, result);
      }
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
  ): { kind: 'room' | 'dm'; room: string } | null {
    if (message?.dmId !== undefined && message.dmId !== null) {
      return { kind: 'dm', room: RedisChannel.dm(message.dmId) };
    }
    if (message?.roomId !== undefined && message.roomId !== null) {
      return { kind: 'room', room: RedisChannel.room(message.roomId) };
    }
    // Upstream returned a malformed row — log + skip fan-out rather than
    // emit into a deterministic `room:orphan` channel. Previous behaviour
    // risked leaking to any client that had joined that named room.
    this.logger.warn(
      `broadcastTarget: message missing both roomId and dmId — dropping emit`,
    );
    return null;
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
