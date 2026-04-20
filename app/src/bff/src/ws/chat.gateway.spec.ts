/**
 * Chat gateway specs — EPIC-03 AC-03-01/03-10/03-11.
 *
 * The gateway owns WS connection lifecycle:
 *   - handshake: Origin allow-list, cookie-only session extraction, userId attach.
 *   - disconnect: TCP call backend presence.disconnect.
 *   - message handlers: room.join (ensureMember + membersOf), presence.ping (touch).
 */
jest.mock('../config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    SYSTEM_KEY: 'test-sys-key',
    TLS_ENABLED: false,
    COOKIE_SECRET: 'c'.repeat(32),
    SESSION_COOKIE_SECRET: 's'.repeat(32),
    SESSION_COOKIE_TTL: 900,
    REFRESH_COOKIE_TTL: 604_800,
    ALLOWED_ORIGINS: 'http://localhost:3007',
    BACKEND_TCP_HOST: '127.0.0.1',
    BACKEND_TCP_PORT: 4004,
    AUTH_TCP_HOST: '127.0.0.1',
    AUTH_TCP_PORT: 4003,
  },
}));

import { of, throwError } from 'rxjs';
import { ChatGateway } from './chat.gateway';
import { WsOriginGuard } from './origin.guard';

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
    ...overrides,
  };
}

function makeCookieService() {
  return {
    readSessionCookie: jest.fn(),
    verifySession: jest.fn(),
  } as any;
}

function makeBackend() {
  return {
    send: jest.fn(),
  } as any;
}

function makeAuth() {
  return {
    send: jest.fn(),
  } as any;
}

function makeSubscriber() {
  return {
    registerSocket: jest.fn(),
    unregisterSocket: jest.fn(),
    subscribeFor: jest.fn().mockResolvedValue(undefined),
    unsubscribeFor: jest.fn().mockResolvedValue(undefined),
  } as any;
}

describe('ChatGateway', () => {
  let cookieSvc: ReturnType<typeof makeCookieService>;
  let backend: ReturnType<typeof makeBackend>;
  let auth: ReturnType<typeof makeAuth>;
  let subscriber: ReturnType<typeof makeSubscriber>;
  let originGuard: WsOriginGuard;
  let gateway: ChatGateway;

  beforeEach(() => {
    cookieSvc = makeCookieService();
    backend = makeBackend();
    auth = makeAuth();
    subscriber = makeSubscriber();
    originGuard = new WsOriginGuard();
    gateway = new ChatGateway(cookieSvc, auth, backend, subscriber, originGuard);
  });

  describe('handleConnection', () => {
    it('rejects disallowed origins and disconnects (4403 semantics via OriginGuard)', async () => {
      const client = makeClient({
        handshake: { headers: { origin: 'http://evil.example', cookie: '' } },
      });

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(cookieSvc.readSessionCookie).not.toHaveBeenCalled();
    });

    it('disconnects missing origin', async () => {
      const client = makeClient({
        handshake: { headers: { cookie: 'session=signed.jwt' } },
      });

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(cookieSvc.readSessionCookie).not.toHaveBeenCalled();
    });

    it('OK origin + valid session cookie → attaches client.data {userId, sessionId}', async () => {
      const client = makeClient();
      cookieSvc.readSessionCookie.mockReturnValue('inner.jwt');
      cookieSvc.verifySession.mockReturnValue({
        userId: 42,
        email: 'u@x',
        name: 'u',
        type: 'user',
        scopes: [],
        iat: 1,
        exp: 2,
      });

      await gateway.handleConnection(client as any);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data).toMatchObject({ userId: 42, sessionId: client.id });
      expect(subscriber.registerSocket).toHaveBeenCalledWith(client);
    });

    it('invalid cookie → disconnect with close code 4401', async () => {
      const client = makeClient();
      cookieSvc.readSessionCookie.mockReturnValue('stale.jwt');
      cookieSvc.verifySession.mockReturnValue(null);

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      // Our close-code signal surfaces via the 'error' emit so the client
      // can distinguish 4401 (auth) from 4403 (origin).
      expect(client.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: 4401 }),
      );
    });

    it('missing cookie header → disconnect 4401', async () => {
      const client = makeClient({
        handshake: { headers: { origin: 'http://localhost:3007' } },
      });

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: 4401 }),
      );
    });

    it('admin session cookie (adminId) → disconnects 4401 (WS is user-only for EPIC-03)', async () => {
      const client = makeClient();
      cookieSvc.readSessionCookie.mockReturnValue('inner.jwt');
      cookieSvc.verifySession.mockReturnValue({
        adminId: 1,
        email: 'a@x',
        name: 'a',
        type: 'admin',
        scopes: [],
      });

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: 4401 }),
      );
    });
  });

  describe('handleDisconnect', () => {
    it('TCP-calls backend presence.disconnect with {userId, sessionId}', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      backend.send.mockReturnValueOnce(of({ ok: true }));

      await gateway.handleDisconnect(client as any);

      expect(backend.send).toHaveBeenCalledWith(
        { cmd: 'presence.disconnect' },
        expect.objectContaining({ _sys: 'test-sys-key', userId: 7, sessionId: client.id }),
      );
      expect(subscriber.unregisterSocket).toHaveBeenCalledWith(client.id);
    });

    it('no-op when client was never authenticated (no userId attached)', async () => {
      const client = makeClient();
      await gateway.handleDisconnect(client as any);
      expect(backend.send).not.toHaveBeenCalled();
      // Still cleans up subscriber interest (defensive)
      expect(subscriber.unregisterSocket).toHaveBeenCalledWith(client.id);
    });

    it('swallows upstream RPC error (disconnect must not throw)', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      backend.send.mockReturnValueOnce(throwError(() => new Error('rpc down')));
      await expect(gateway.handleDisconnect(client as any)).resolves.toBeUndefined();
    });
  });

  describe('room.join', () => {
    it('calls rooms.ensureMember + rooms.membersOf, joins socket.io room, emits ack', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      backend.send.mockImplementation((pattern: any) => {
        if (pattern.cmd === 'rooms.ensureMember') return of({ ok: true });
        if (pattern.cmd === 'rooms.membersOf')
          return of([
            { userId: 7, role: 'member' },
            { userId: 8, role: 'owner' },
          ]);
        return throwError(() => new Error(`unexpected ${pattern.cmd}`));
      });

      const ack = await gateway.onRoomJoin(client as any, { roomId: 5 });

      expect(backend.send).toHaveBeenCalledWith(
        { cmd: 'rooms.ensureMember' },
        expect.objectContaining({ _sys: 'test-sys-key', userId: 7, roomId: 5 }),
      );
      expect(backend.send).toHaveBeenCalledWith(
        { cmd: 'rooms.membersOf' },
        expect.objectContaining({ _sys: 'test-sys-key', roomId: 5 }),
      );
      expect(client.join).toHaveBeenCalledWith('room:5');
      expect(subscriber.subscribeFor).toHaveBeenCalledWith(client.id, 'room:5');
      expect(ack).toEqual({
        ok: true,
        roomId: 5,
        members: [
          { userId: 7, role: 'member' },
          { userId: 8, role: 'owner' },
        ],
      });
    });

    it('rejects unauthenticated sockets', async () => {
      const client = makeClient(); // no data.userId
      const ack = await gateway.onRoomJoin(client as any, { roomId: 5 });
      expect(ack).toMatchObject({ ok: false });
      expect(backend.send).not.toHaveBeenCalled();
    });

    it('propagates upstream error in ack when ensureMember fails', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      backend.send.mockReturnValueOnce(throwError(() => ({ status: 403, message: 'banned' })));

      const ack = await gateway.onRoomJoin(client as any, { roomId: 5 });

      expect(ack).toMatchObject({ ok: false });
      expect(client.join).not.toHaveBeenCalled();
      expect(subscriber.subscribeFor).not.toHaveBeenCalled();
    });
  });

  describe('presence.ping', () => {
    it('calls backend presence.touch with userId', async () => {
      const client = makeClient();
      client.data = { userId: 7, sessionId: client.id };
      backend.send.mockReturnValueOnce(of({ ok: true }));

      const ack = await gateway.onPresencePing(client as any);

      expect(backend.send).toHaveBeenCalledWith(
        { cmd: 'presence.touch' },
        expect.objectContaining({ _sys: 'test-sys-key', userId: 7, sessionId: client.id }),
      );
      expect(ack).toEqual({ ok: true });
    });

    it('no-op for unauthenticated sockets', async () => {
      const client = makeClient();
      const ack = await gateway.onPresencePing(client as any);
      expect(ack).toMatchObject({ ok: false });
      expect(backend.send).not.toHaveBeenCalled();
    });
  });
});
