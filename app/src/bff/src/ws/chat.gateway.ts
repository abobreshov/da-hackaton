import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  UseGuards,
} from '@nestjs/common';
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
import { firstValueFrom } from 'rxjs';
import fastifyCookie from '@fastify/cookie';
import { RedisChannel, TcpCmd, WsEvent } from '@app/contracts';
import { CookieService, type SessionPayload } from '../auth/cookie.service';
import { AUTH_SERVICE, BACKEND_SERVICE } from '../common/microservice.module';
import { withSys } from '../common/rpc-transport';
import { env } from '../config/environment';
import { WsOriginGuard } from './origin.guard';
import { RedisSubscriberService } from './redis-subscriber.service';

/**
 * EPIC-03 WS gateway.
 *
 * Connection lifecycle:
 *   1. Origin allow-list via WsOriginGuard (close code 4403).
 *   2. Cookie-only session: unsign via @fastify/cookie header, verify JWT
 *      with CookieService.verifySession. No session ticket / query param
 *      accepted (AC-03-10).
 *   3. Only `type: user` sessions authenticate over WS — admins stay
 *      on the HTTP control plane.
 *   4. Attach `{ userId, sessionId }` to client.data, register with the
 *      subscriber for fanout.
 *
 * Handlers are defensive: unauthenticated sockets get `{ ok: false }`
 * acks rather than throwing, because Socket.IO turns exceptions into
 * anonymous `error` emits which are harder to diagnose from the FE.
 */
@Injectable()
@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3007').split(','),
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(ChatGateway.name);
  private readonly signer = new (fastifyCookie as any).Signer(env.COOKIE_SECRET);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly cookieSvc: CookieService,
    @Inject(AUTH_SERVICE) private readonly auth: ClientProxy,
    @Inject(BACKEND_SERVICE) private readonly backend: ClientProxy,
    private readonly subscriber: RedisSubscriberService,
    private readonly originGuard: WsOriginGuard,
  ) {}

  onModuleInit(): void {
    // Hook Nest lifecycle. The origin guard is enforced in handleConnection
    // directly (not via @UseGuards) because gateway-level guards don't run
    // on the raw upgrade in every Nest version — we want deterministic 403.
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

    // 2. Parse signed session cookie from handshake header.
    const cookieHeader = client.handshake?.headers?.cookie as string | undefined;
    const session = this.readSessionFromCookieHeader(cookieHeader);
    if (!session || session.type !== 'user' || typeof session.userId !== 'number') {
      this.reject(client, 4401, 'Unauthenticated');
      return;
    }

    // 3. Attach identity + register in the subscriber's interest graph.
    client.data.userId = session.userId;
    client.data.sessionId = client.id;
    this.subscriber.registerSocket(client as any);
    // Every authenticated socket cares about its own user channel
    // (for server-pushed events addressed to that user).
    try {
      await this.subscriber.subscribeFor(client.id, RedisChannel.user(session.userId));
    } catch (e) {
      this.logger.error(`user-channel subscribe failed: ${(e as Error).message}`);
    }
  }

  private readSessionFromCookieHeader(header?: string): SessionPayload | null {
    if (!header) return null;
    // Build the minimal request shape CookieService expects — it reads
    // `req.cookies.session` and calls `req.unsignCookie(value)`. We parse
    // the header with @fastify/cookie's own parser and delegate HMAC
    // verification to its Signer (same secret used by `main.ts`).
    const cookies = (fastifyCookie as any).parse(header) as Record<string, string>;
    if (!cookies || !cookies['session']) return null;
    const req = {
      cookies,
      unsignCookie: (v: string) => this.signer.unsign(v),
    } as any;
    const inner = this.cookieSvc.readSessionCookie(req);
    if (!inner) return null;
    return this.cookieSvc.verifySession(inner);
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

  // ----------------------------------------------------------- disconnect
  async handleDisconnect(client: Socket): Promise<void> {
    const userId = client.data?.userId as number | undefined;
    const sessionId = client.data?.sessionId as string | undefined;
    this.subscriber.unregisterSocket(client.id);
    if (!userId) return;
    try {
      await firstValueFrom(
        this.backend.send(
          { cmd: TcpCmd.presence.disconnect },
          withSys({ userId, sessionId: sessionId ?? client.id }),
        ),
      );
    } catch (e) {
      this.logger.warn(`presence.disconnect failed: ${(e as Error).message}`);
    }
  }

  // --------------------------------------------------------- room.join
  @UseGuards(WsOriginGuard)
  @SubscribeMessage('room.join')
  async onRoomJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: number },
  ): Promise<{ ok: boolean; roomId?: number; members?: any[]; error?: string }> {
    const userId = client.data?.userId as number | undefined;
    if (!userId) return { ok: false, error: 'unauthenticated' };
    const roomId = Number(body?.roomId);
    if (!Number.isFinite(roomId)) return { ok: false, error: 'invalid roomId' };

    try {
      await firstValueFrom(
        this.backend.send(
          { cmd: TcpCmd.rooms.ensureMember },
          withSys({ userId, roomId }),
        ),
      );
      const members = await firstValueFrom<any[]>(
        this.backend.send(
          { cmd: TcpCmd.rooms.membersOf },
          withSys({ roomId }),
        ),
      );
      client.join(RedisChannel.room(roomId));
      await this.subscriber.subscribeFor(client.id, RedisChannel.room(roomId));
      return { ok: true, roomId, members: members ?? [] };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'room.join failed' };
    }
  }

  // -------------------------------------------------------- room.leave
  @UseGuards(WsOriginGuard)
  @SubscribeMessage('room.leave')
  async onRoomLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: number },
  ): Promise<{ ok: boolean }> {
    const userId = client.data?.userId as number | undefined;
    if (!userId) return { ok: false };
    const roomId = Number(body?.roomId);
    if (!Number.isFinite(roomId)) return { ok: false };
    client.leave(RedisChannel.room(roomId));
    await this.subscriber.unsubscribeFor(client.id, RedisChannel.room(roomId));
    return { ok: true };
  }

  // ----------------------------------------------------- presence.ping
  @UseGuards(WsOriginGuard)
  @SubscribeMessage('presence.ping')
  async onPresencePing(
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: boolean }> {
    const userId = client.data?.userId as number | undefined;
    const sessionId = client.data?.sessionId as string | undefined;
    if (!userId) return { ok: false };
    try {
      await firstValueFrom(
        this.backend.send(
          { cmd: TcpCmd.presence.touch },
          withSys({ userId, sessionId: sessionId ?? client.id }),
        ),
      );
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }
}

