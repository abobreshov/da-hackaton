/**
 * SessionsService (BFF) — wire-shape assertions for the BFF↔backend TCP
 * boundary. Catches the M5 review CRITICAL: the BFF was forwarding
 * `{ sessionId, userId }` while the backend's `RevokePayload` reads
 * `data.id`, silently no-op'ing every revoke.
 */
jest.mock('../../config/environment', () => ({
  env: {
    SYSTEM_KEY: 'test-sys-key',
    TLS_ENABLED: false,
    BACKEND_TCP_HOST: '127.0.0.1',
    BACKEND_TCP_PORT: 4004,
    AUTH_TCP_HOST: '127.0.0.1',
    AUTH_TCP_PORT: 4003,
    NODE_ENV: 'test',
  },
}));

import 'reflect-metadata';
import { TcpCmd } from '@app/contracts';
import { SessionsService } from './sessions.service';

describe('SessionsService (BFF) — wire shape', () => {
  let proxy: { forward: jest.Mock };
  let client: object;
  let service: SessionsService;

  beforeEach(() => {
    proxy = { forward: jest.fn().mockResolvedValue({}) };
    client = {};
    service = new SessionsService(client as any, proxy as any);
  });

  it('listForUser forwards { userId } on TcpCmd.sessions.listForUser', async () => {
    proxy.forward.mockResolvedValueOnce({ sessions: [] });
    await service.listForUser(42);
    expect(proxy.forward).toHaveBeenCalledWith(
      client,
      { cmd: TcpCmd.sessions.listForUser },
      { userId: 42 },
    );
  });

  it('revoke forwards { id, userId } (NOT { sessionId, ... }) on TcpCmd.sessions.revoke', async () => {
    proxy.forward.mockResolvedValueOnce({ revoked: true });
    const sessionId = 'abcdef01-2345-6789-abcd-ef0123456789';
    await service.revoke({ sessionId, userId: 7 });

    // Wire field MUST be `id` to match backend `RevokePayload.id`. If this
    // ever flips back to `sessionId`, every DELETE becomes a silent no-op.
    expect(proxy.forward).toHaveBeenCalledWith(
      client,
      { cmd: TcpCmd.sessions.revoke },
      { id: sessionId, userId: 7 },
    );
    const sentPayload = proxy.forward.mock.calls[0][2];
    expect(sentPayload).not.toHaveProperty('sessionId');
  });
});
