/**
 * Chat gateway specs — EPIC-03 WS lifecycle + message handlers.
 *
 * Scope:
 *   - handshake: Origin allow-list, WsAuthenticator delegation, userId attach.
 *   - disconnect: TCP presence.disconnect, subscriber cleanup.
 *   - room.join / room.leave / presence.ping (existing, now via RpcProxyService).
 *   - message.send / message.edit / message.delete — forward to backend,
 *     fan-out through Socket.IO rooms (no custom redis subscribe for msgs).
 *   - sync.since — forward to backend, return ack, no broadcast.
 */
jest.mock('../config/environment', () => {
  const env = {
    NODE_ENV: 'test',
    SYSTEM_KEY: 'test-sys-key',
    TLS_ENABLED: false,
    COOKIE_SECRET: 'c'.repeat(32),
    SESSION_COOKIE_SECRET: 's'.repeat(32),
    SESSION_COOKIE_TTL: 900,
    REFRESH_COOKIE_TTL: 604_800,
    ALLOWED_ORIGINS: 'http://localhost:3007',
    ALLOWED_WS_ORIGINS: undefined as string | undefined,
    BACKEND_TCP_HOST: '127.0.0.1',
    BACKEND_TCP_PORT: 4004,
    AUTH_TCP_HOST: '127.0.0.1',
    AUTH_TCP_PORT: 4003,
  };
  return {
    env,
    // Mirror the real resolver so both gateway decorator + guard read the
    // same canonical list. Re-evaluates on each call so per-test mutations
    // to `env.ALLOWED_WS_ORIGINS` / `env.ALLOWED_ORIGINS` take effect.
    resolveAllowedWsOrigins: () => {
      const raw =
        env.ALLOWED_WS_ORIGINS && env.ALLOWED_WS_ORIGINS.length > 0
          ? env.ALLOWED_WS_ORIGINS
          : env.ALLOWED_ORIGINS;
      return Array.from(
        new Set(
          (raw ?? '')
            .split(',')
            .map((o: string) => o.trim())
            .filter(Boolean),
        ),
      );
    },
  };
});

import { ChatGateway } from './chat.gateway';
import { WsOriginGuard } from './origin.guard';
import { RpcProxyService } from '../common/proxy/rpc-proxy.service';
import { WsAuthenticator } from './ws-authenticator.service';
import { WsConnectRateLimit } from './ws-connect-rate-limit.service';

function makeClient(overrides: Partial<any> = {}) {
  return {
    id: 'socket-1',
    handshake: {
      headers: { origin: 'http://localhost:3007', cookie: 'session=signed.jwt' },
    },
    data: {},
    disconnect: jest.fn(),
    emit: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    rooms: new Set<string>(),
    ...overrides,
  };
}

function makeBackend() {
  return { send: jest.fn() } as any;
}

function makeAuth() {
  return { send: jest.fn() } as any;
}

function makeSubscriber() {
  return {
    registerSocket: jest.fn(),
    unregisterSocket: jest.fn(),
    subscribeFor: jest.fn().mockResolvedValue(undefined),
    unsubscribeFor: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function makeAuthenticator() {
  return {
    authenticate: jest.fn(),
  } as unknown as jest.Mocked<WsAuthenticator>;
}

function makeProxy() {
  return { forward: jest.fn() } as unknown as jest.Mocked<RpcProxyService>;
}

function makeConnectLimiter() {
  return {
    check: jest.fn().mockResolvedValue({ ok: true }),
  } as unknown as jest.Mocked<WsConnectRateLimit>;
}

function makeServer() {
  const emit = jest.fn();
  const to = jest.fn(() => ({ emit }));
  const sockets = {
    in: jest.fn(() => ({
      fetchSockets: jest.fn().mockResolvedValue([]),
      disconnectSockets: jest.fn(),
    })),
    // socket.io v4 also surfaces `.socketsLeave(room)` — not used by gateway.
  };
  return { to, sockets, __emit: emit, __to: to } as any;
}

describe('ChatGateway', () => {
  let backend: ReturnType<typeof makeBackend>;
  let auth: ReturnType<typeof makeAuth>;
  let subscriber: ReturnType<typeof makeSubscriber>;
  let originGuard: WsOriginGuard;
  let authenticator: jest.Mocked<WsAuthenticator>;
  let proxy: jest.Mocked<RpcProxyService>;
  let connectLimiter: jest.Mocked<WsConnectRateLimit>;
  let gateway: ChatGateway;
  let server: ReturnType<typeof makeServer>;

  beforeEach(() => {
    backend = makeBackend();
    auth = makeAuth();
    subscriber = makeSubscriber();
    originGuard = new WsOriginGuard();
    authenticator = makeAuthenticator();
    proxy = makeProxy();
    connectLimiter = makeConnectLimiter();
    gateway = new ChatGateway(
      authenticator,
      auth,
      backend,
      subscriber,
      originGuard,
      proxy,
      connectLimiter,
    );
    server = makeServer();
    (gateway as any).server = server;
  });

  // --------------------------------------------------------------- connect
  describe('handleConnection', () => {
    it('rejects disallowed origins and disconnects (4403 via OriginGuard)', async () => {
      const client = makeClient({
        handshake: { headers: { origin: 'http://evil.example', cookie: '' } },
      });

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(authenticator.authenticate).not.toHaveBeenCalled();
    });

    it('disconnects missing origin', async () => {
      const client = makeClient({
        handshake: { headers: { cookie: 'session=signed.jwt' } },
      });

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(authenticator.authenticate).not.toHaveBeenCalled();
    });

    it('delegates to WsAuthenticator; attaches {userId, sessionId} on success', async () => {
      const client = makeClient();
      authenticator.authenticate.mockReturnValue({ userId: 42, sessionId: client.id });

      await gateway.handleConnection(client as any);

      expect(authenticator.authenticate).toHaveBeenCalledWith(client);
      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data).toMatchObject({ userId: 42, sessionId: client.id });
      expect(subscriber.registerSocket).toHaveBeenCalledWith(client);
      // Still subscribes the user-channel (kept per spec — user:{id} stays).
      expect(subscriber.subscribeFor).toHaveBeenCalledWith(client.id, 'user:42');
    });

    it('null from authenticator → disconnect 4401', async () => {
      const client = makeClient();
      authenticator.authenticate.mockReturnValue(null);

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.emit).toHaveBeenCalledWith('error', expect.objectContaining({ code: 4401 }));
    });

    // AC-14-12 — rate-limit burst of WS connects per user (10 per 60 s).
    it('WsConnectRateLimit reject → disconnects with 4429 + emits WireError RATE_LIMITED', async () => {
      const client = makeClient();
      authenticator.authenticate.mockReturnValue({ userId: 42, sessionId: client.id });
      connectLimiter.check.mockResolvedValueOnce({ ok: false, retryAfterMs: 12_345 });

      await gateway.handleConnection(client as any);

      expect(connectLimiter.check).toHaveBeenCalledWith(42);
      expect(client.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          code: 'RATE_LIMITED',
          retryAfterMs: 12_345,
        }),
      );
      expect(client.disconnect).toHaveBeenCalledWith(true);
      // Must NOT register the socket when rejected — protects downstream
      // subscriber bookkeeping from a half-connected peer.
      expect(subscriber.registerSocket).not.toHaveBeenCalled();
      expect(subscriber.subscribeFor).not.toHaveBeenCalled();
    });

    it('WsConnectRateLimit ok → proceeds to register the socket', async () => {
      const client = makeClient();
      authenticator.authenticate.mockReturnValue({ userId: 42, sessionId: client.id });
      connectLimiter.check.mockResolvedValueOnce({ ok: true });

      await gateway.handleConnection(client as any);

      expect(connectLimiter.check).toHaveBeenCalledWith(42);
      expect(subscriber.registerSocket).toHaveBeenCalledWith(client);
    });
  });

  // ------------------------------------------------------------ disconnect
  describe('handleDisconnect', () => {
    it('forwards presence.disconnect via RpcProxyService with {userId, sessionId}', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      proxy.forward.mockResolvedValueOnce({ ok: true } as any);

      await gateway.handleDisconnect(client as any);

      expect(proxy.forward).toHaveBeenCalledWith(
        backend,
        { cmd: 'presence.disconnect' },
        { userId: 7, sessionId: client.id },
      );
      expect(subscriber.unregisterSocket).toHaveBeenCalledWith(client.id);
    });

    it('no-op when client was never authenticated', async () => {
      const client = makeClient();

      await gateway.handleDisconnect(client as any);

      expect(proxy.forward).not.toHaveBeenCalled();
      expect(subscriber.unregisterSocket).toHaveBeenCalledWith(client.id);
    });

    it('swallows upstream RPC error (disconnect must not throw)', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      proxy.forward.mockRejectedValueOnce(new Error('rpc down'));
      await expect(gateway.handleDisconnect(client as any)).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------- room.join
  describe('room.join', () => {
    it('ensureMember + membersOf → joins socket.io room (no custom msg subscribe)', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      proxy.forward.mockImplementation(async (_client, pattern: any) => {
        if (pattern.cmd === 'rooms.ensureMember') return { ok: true } as any;
        if (pattern.cmd === 'rooms.membersOf') {
          return {
            members: [
              { userId: 7, role: 'member' },
              { userId: 8, role: 'owner' },
            ],
          } as any;
        }
        if (pattern.cmd === 'rooms.catalog') {
          return [
            { id: 5, name: 'general', description: 'hi' },
            { id: 6, name: 'random', description: null },
          ] as any;
        }
        throw new Error(`unexpected ${pattern.cmd}`);
      });

      const ack = await gateway.onRoomJoin(client as any, { roomId: 5 });

      expect(proxy.forward).toHaveBeenCalledWith(
        backend,
        { cmd: 'rooms.ensureMember' },
        { userId: 7, roomId: 5 },
      );
      expect(proxy.forward).toHaveBeenCalledWith(
        backend,
        { cmd: 'rooms.membersOf' },
        { roomId: 5 },
      );
      expect(client.join).toHaveBeenCalledWith('room:5');
      // Socket.IO redis-adapter handles cross-replica room:{id} fanout;
      // the BFF must NOT manually SUBSCRIBE `room:{id}` for messages.
      expect(subscriber.subscribeFor).not.toHaveBeenCalledWith(client.id, 'room:5');
      expect(ack).toEqual({
        ok: true,
        roomId: 5,
        room: { id: 5, name: 'general', description: 'hi' },
        members: [
          { userId: 7, role: 'member' },
          { userId: 8, role: 'owner' },
        ],
      });
    });

    it('rejects unauthenticated sockets', async () => {
      const client = makeClient();
      const ack = await gateway.onRoomJoin(client as any, { roomId: 5 });
      expect(ack).toMatchObject({ ok: false });
      expect(proxy.forward).not.toHaveBeenCalled();
    });

    it('propagates upstream error in ack when ensureMember fails', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      proxy.forward.mockRejectedValueOnce({ status: 403, message: 'banned' } as any);

      const ack = await gateway.onRoomJoin(client as any, { roomId: 5 });

      expect(ack).toMatchObject({ ok: false });
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------- presence.ping
  describe('presence.ping', () => {
    it('forwards presence.touch via RpcProxyService', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      proxy.forward.mockResolvedValueOnce({ ok: true } as any);

      const ack = await gateway.onPresencePing(client as any);

      expect(proxy.forward).toHaveBeenCalledWith(
        backend,
        { cmd: 'presence.touch' },
        { userId: 7, sessionId: client.id },
      );
      expect(ack).toEqual({ ok: true });
    });

    it('no-op for unauthenticated sockets', async () => {
      const client = makeClient();
      const ack = await gateway.onPresencePing(client as any);
      expect(ack).toMatchObject({ ok: false });
      expect(proxy.forward).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------- message.send
  describe('message.send', () => {
    it('room mode — forwards messages.create, emits messageNew to room:<id>, returns ack', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      const created = { id: 101, roomId: 5, authorId: 7, body: 'hi' };
      proxy.forward.mockResolvedValueOnce(created as any);

      const ack = await gateway.onMessageSend(client as any, {
        roomId: 5,
        body: 'hi',
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        backend,
        { cmd: 'messages.create' },
        { authorId: 7, roomId: 5, body: 'hi' },
      );
      expect(server.__to).toHaveBeenCalledWith('room:5');
      expect(server.__emit).toHaveBeenCalledWith('message.new', {
        message: created,
        attachments: [],
      });
      expect(ack).toEqual({ ok: true, message: created, attachments: [] });
    });

    it('dm mode — emits messageNew to dm:<id> (uses created.dmId for fan-out target)', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      const created = { id: 202, dmId: 99, authorId: 7, body: 'hey' };
      proxy.forward.mockResolvedValueOnce(created as any);

      const ack = await gateway.onMessageSend(client as any, {
        dmUserId: 12,
        body: 'hey',
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        backend,
        { cmd: 'messages.create' },
        { authorId: 7, dmUserId: 12, body: 'hey' },
      );
      // Ensure we joined the DM socket.io room first (first-message-ever path)
      expect(client.join).toHaveBeenCalledWith('dm:99');
      expect(server.__to).toHaveBeenCalledWith('dm:99');
      expect(server.__emit).toHaveBeenCalledWith('message.new', {
        message: created,
        attachments: [],
      });
      expect(ack).toEqual({ ok: true, message: created, attachments: [] });
    });

    it('unwraps `{message, attachments}` shape and forwards attachmentIds', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      const created = {
        message: { id: 303, roomId: 5, authorId: 7, body: 'hi' },
        attachments: [
          { id: 'uuid-a', filename: 'a.png', mime: 'image/png', sizeBytes: 100, isImage: true },
        ],
      };
      proxy.forward.mockResolvedValueOnce(created as any);

      const ack = await gateway.onMessageSend(client as any, {
        roomId: 5,
        body: 'hi',
        attachmentIds: ['uuid-a'],
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        backend,
        { cmd: 'messages.create' },
        { authorId: 7, roomId: 5, body: 'hi', attachmentIds: ['uuid-a'] },
      );
      expect(server.__to).toHaveBeenCalledWith('room:5');
      expect(server.__emit).toHaveBeenCalledWith('message.new', {
        message: created.message,
        attachments: created.attachments,
      });
      expect(ack).toEqual({
        ok: true,
        message: created.message,
        attachments: created.attachments,
      });
    });

    it('forwards replyToId when present', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      proxy.forward.mockResolvedValueOnce({ id: 1, roomId: 5 } as any);

      await gateway.onMessageSend(client as any, {
        roomId: 5,
        body: 'hi',
        replyToId: 42,
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        backend,
        { cmd: 'messages.create' },
        { authorId: 7, roomId: 5, body: 'hi', replyToId: 42 },
      );
    });

    it('upstream error → ack {ok:false, error} and no fan-out', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      proxy.forward.mockRejectedValueOnce({ status: 403, message: 'banned' } as any);

      const ack = await gateway.onMessageSend(client as any, {
        roomId: 5,
        body: 'hi',
      });

      expect(ack).toMatchObject({ ok: false });
      expect((ack as any).error).toBeDefined();
      expect(server.__to).not.toHaveBeenCalled();
      expect(server.__emit).not.toHaveBeenCalled();
    });

    it('unauthenticated → ack {ok:false}', async () => {
      const client = makeClient();
      const ack = await gateway.onMessageSend(client as any, {
        roomId: 5,
        body: 'hi',
      });
      expect(ack).toMatchObject({ ok: false });
      expect(proxy.forward).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------- message.edit
  describe('message.edit', () => {
    it('forwards messages.edit, emits messageEdited to room:<id>, acks', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      const edited = { id: 101, roomId: 5, body: 'fixed' };
      proxy.forward.mockResolvedValueOnce(edited as any);

      const ack = await gateway.onMessageEdit(client as any, { id: 101, body: 'fixed' });

      expect(proxy.forward).toHaveBeenCalledWith(
        backend,
        { cmd: 'messages.edit' },
        { editorId: 7, id: 101, body: 'fixed' },
      );
      expect(server.__to).toHaveBeenCalledWith('room:5');
      expect(server.__emit).toHaveBeenCalledWith('message.edited', { message: edited });
      expect(ack).toEqual({ ok: true, message: edited });
    });

    it('dm-mode edited → emits to dm:<id>', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      const edited = { id: 202, dmId: 99, body: 'fix' };
      proxy.forward.mockResolvedValueOnce(edited as any);

      await gateway.onMessageEdit(client as any, { id: 202, body: 'fix' });

      expect(server.__to).toHaveBeenCalledWith('dm:99');
      expect(server.__emit).toHaveBeenCalledWith('message.edited', { message: edited });
    });

    it('upstream error → ack {ok:false}', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      proxy.forward.mockRejectedValueOnce({ status: 403, message: 'forbidden' } as any);

      const ack = await gateway.onMessageEdit(client as any, { id: 1, body: 'x' });

      expect(ack).toMatchObject({ ok: false });
      expect(server.__emit).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------- message.delete
  describe('message.delete', () => {
    it('forwards messages.delete, emits messageDeleted to room:<id>, acks', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      proxy.forward.mockResolvedValueOnce({ id: 101, roomId: 5 } as any);

      const ack = await gateway.onMessageDelete(client as any, { id: 101 });

      expect(proxy.forward).toHaveBeenCalledWith(
        backend,
        { cmd: 'messages.delete' },
        { actorId: 7, id: 101 },
      );
      expect(server.__to).toHaveBeenCalledWith('room:5');
      expect(server.__emit).toHaveBeenCalledWith('message.deleted', { id: 101, roomId: 5 });
      expect(ack).toEqual({ ok: true });
    });

    it('dm-mode delete → emits to dm:<id>', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      proxy.forward.mockResolvedValueOnce({ id: 202, dmId: 99 } as any);

      await gateway.onMessageDelete(client as any, { id: 202 });

      expect(server.__to).toHaveBeenCalledWith('dm:99');
      expect(server.__emit).toHaveBeenCalledWith('message.deleted', { id: 202, dmId: 99 });
    });

    it('upstream error → ack {ok:false}', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      proxy.forward.mockRejectedValueOnce({ status: 404, message: 'gone' } as any);

      const ack = await gateway.onMessageDelete(client as any, { id: 1 });
      expect(ack).toMatchObject({ ok: false });
      expect(server.__emit).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------- sync.since
  describe('sync.since', () => {
    it('room mode — forwards messages.since, returns ack {messages}, no broadcast', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      const msgs = [{ id: 1 }, { id: 2 }];
      proxy.forward.mockResolvedValueOnce(msgs as any);

      const ack = await gateway.onSyncSince(client as any, {
        roomId: 5,
        lastSeenId: 0,
      });

      expect(proxy.forward).toHaveBeenCalledWith(
        backend,
        { cmd: 'messages.since' },
        { userId: 7, roomId: 5, lastSeenId: 0 },
      );
      expect(server.__to).not.toHaveBeenCalled();
      expect(ack).toEqual({ ok: true, messages: msgs });
    });

    it('dm mode — forwards dmUserId in payload', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      proxy.forward.mockResolvedValueOnce([] as any);

      await gateway.onSyncSince(client as any, { dmUserId: 12, lastSeenId: 10 });

      expect(proxy.forward).toHaveBeenCalledWith(
        backend,
        { cmd: 'messages.since' },
        { userId: 7, dmUserId: 12, lastSeenId: 10 },
      );
    });

    it('upstream error → ack {ok:false}', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      proxy.forward.mockRejectedValueOnce(new Error('boom'));

      const ack = await gateway.onSyncSince(client as any, { roomId: 5, lastSeenId: 0 });
      expect(ack).toMatchObject({ ok: false });
    });

    it('unauthenticated → ack {ok:false}', async () => {
      const client = makeClient();
      const ack = await gateway.onSyncSince(client as any, { roomId: 5, lastSeenId: 0 });
      expect(ack).toMatchObject({ ok: false });
      expect(proxy.forward).not.toHaveBeenCalled();
    });
  });

  // -------------------------- canonical origin source (sys-arch LOW #6)
  // The @WebSocketGateway cors.origin and WsOriginGuard MUST resolve through
  // the same source (`resolveAllowedWsOrigins`). Two sources of truth caused
  // the classic "WS connects then dies on first room.join" — the upgrade
  // accepted the origin but the guard rejected on the first frame.
  describe('origin allow-list — gateway and guard share one source', () => {
    it('@WebSocketGateway cors.origin equals WsOriginGuard allow-list', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveAllowedWsOrigins } = require('../config/environment');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { GATEWAY_OPTIONS } = require('@nestjs/websockets/constants');

      const opts = Reflect.getMetadata(GATEWAY_OPTIONS, ChatGateway);
      expect(opts).toBeDefined();
      expect(opts.cors).toBeDefined();
      const cors = opts.cors as { origin: string[]; credentials: boolean };

      // 1. Decorator must NOT inline raw process.env (string fallback) —
      // it must call the canonical resolver and store an array.
      expect(Array.isArray(cors.origin)).toBe(true);
      // 2. The decorator-recorded list must match resolveAllowedWsOrigins().
      expect(cors.origin).toEqual(resolveAllowedWsOrigins());
      // 3. WsOriginGuard, constructed fresh, must accept exactly the same set.
      const guard = new WsOriginGuard();
      const allowed = (guard as any).allowed as Set<string>;
      expect(Array.from(allowed).sort()).toEqual([...cors.origin].sort());
      // 4. Sanity: known dev origin is in there.
      expect(allowed.has('http://localhost:3007')).toBe(true);
    });
  });

  // ------------------------------------------------------- onDmFrozen(id)
  describe('onDmFrozen(dmId)', () => {
    it('emits error {code:"DM_FROZEN"} to dm:<id> and evicts sockets', async () => {
      const evict = jest.fn();
      const emit = jest.fn();
      (server as any).to = jest.fn(() => ({ emit }));
      (server as any).in = jest.fn(() => ({ socketsLeave: evict }));

      await gateway.onDmFrozen(99);

      expect((server as any).to).toHaveBeenCalledWith('dm:99');
      expect(emit).toHaveBeenCalledWith('error', expect.objectContaining({ code: 'DM_FROZEN' }));
      expect((server as any).in).toHaveBeenCalledWith('dm:99');
      expect(evict).toHaveBeenCalledWith('dm:99');
    });
  });
});
