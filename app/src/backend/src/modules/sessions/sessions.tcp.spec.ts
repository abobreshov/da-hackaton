/**
 * TCP-layer tests for `SessionsTcpController` — pattern wiring + delegation.
 * Domain rules live in SessionsService.
 */

import { TcpCmd } from '@app/contracts';
import { SessionsTcpController } from './sessions.tcp';
import { SessionsService } from './sessions.service';
import type { SessionRow } from './sessions.types';

function makeService(): jest.Mocked<SessionsService> {
  return {
    recordLogin: jest.fn(),
    listActive: jest.fn(),
    revoke: jest.fn(),
    isRevoked: jest.fn(),
  } as unknown as jest.Mocked<SessionsService>;
}

function makeRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'uuid-1',
    userId: 7,
    userAgent: 'Mozilla/5.0',
    ip: '203.0.113.4',
    createdAt: new Date('2026-04-20T10:00:00Z'),
    lastSeenAt: new Date('2026-04-20T10:00:00Z'),
    revokedAt: null,
    ...overrides,
  };
}

describe('SessionsTcpController', () => {
  let service: jest.Mocked<SessionsService>;
  let controller: SessionsTcpController;

  beforeEach(() => {
    service = makeService();
    controller = new SessionsTcpController(service);
  });

  it('exposes a @MessagePattern for every sessions.* TcpCmd', () => {
    const expected = new Set<string>(Object.values(TcpCmd.sessions));
    const proto = Object.getPrototypeOf(controller);
    const methods = Object.getOwnPropertyNames(proto).filter((m) => m !== 'constructor');

    const seen = new Set<string>();
    for (const m of methods) {
      const raw = Reflect.getMetadata('microservices:pattern', proto[m]);
      if (!raw) continue;
      const patterns: unknown[] = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? ([] as unknown[]).concat(JSON.parse(raw))
          : [raw];
      for (const p of patterns) {
        if (typeof p === 'string') seen.add(p);
        else if (p && typeof (p as { cmd?: unknown }).cmd === 'string') {
          seen.add((p as { cmd: string }).cmd);
        }
      }
    }
    expect(seen).toEqual(expected);
  });

  it('sessions.recordLogin forwards payload and returns the persisted row', async () => {
    const row = makeRow();
    service.recordLogin.mockResolvedValue(row);
    const out = await controller.recordLogin({
      userId: 7,
      userAgent: 'Mozilla/5.0',
      ip: '203.0.113.4',
    });
    expect(service.recordLogin).toHaveBeenCalledWith({
      userId: 7,
      id: undefined,
      userAgent: 'Mozilla/5.0',
      ip: '203.0.113.4',
    });
    expect(out).toEqual(row);
  });

  it('sessions.recordLogin tolerates `_sys` and forwards only domain fields', async () => {
    service.recordLogin.mockResolvedValue(makeRow());
    await controller.recordLogin({
      userId: 7,
      userAgent: 'UA',
      ip: '1.2.3.4',
      _sys: 'secret',
    } as any);
    expect(service.recordLogin).toHaveBeenCalledWith({
      userId: 7,
      id: undefined,
      userAgent: 'UA',
      ip: '1.2.3.4',
    });
  });

  it('sessions.listForUser forwards userId and returns service result', async () => {
    const rows = [makeRow(), makeRow({ id: 'uuid-2' })];
    service.listActive.mockResolvedValue(rows);
    const out = await controller.listForUser({ userId: 42 });
    expect(service.listActive).toHaveBeenCalledWith(42);
    expect(out).toEqual({ sessions: rows });
  });

  it('sessions.revoke forwards { id, userId } and returns revoke result', async () => {
    service.revoke.mockResolvedValue({ revoked: true });
    const out = await controller.revoke({ id: 'uuid-1', userId: 7 });
    expect(service.revoke).toHaveBeenCalledWith({ id: 'uuid-1', userId: 7 });
    expect(out).toEqual({ revoked: true });
  });

  it('sessions.revoke returns { revoked: false } when service finds no match', async () => {
    service.revoke.mockResolvedValue({ revoked: false });
    const out = await controller.revoke({ id: 'no-such', userId: 7 });
    expect(out).toEqual({ revoked: false });
  });

  it('sessions.isRevoked forwards sessionId and wraps result as { revoked }', async () => {
    service.isRevoked.mockResolvedValue(false);
    const out = await controller.isRevoked({ sessionId: 'uuid-1' });
    expect(service.isRevoked).toHaveBeenCalledWith('uuid-1');
    expect(out).toEqual({ revoked: false });
  });

  it('sessions.isRevoked returns { revoked: true } for revoked / unknown ids', async () => {
    service.isRevoked.mockResolvedValue(true);
    const out = await controller.isRevoked({ sessionId: 'no-such' });
    expect(out).toEqual({ revoked: true });
  });

  it('sessions.isRevoked tolerates `_sys` and forwards only the domain field', async () => {
    service.isRevoked.mockResolvedValue(false);
    await controller.isRevoked({ sessionId: 'uuid-1', _sys: 'secret' } as any);
    expect(service.isRevoked).toHaveBeenCalledWith('uuid-1');
  });
});
