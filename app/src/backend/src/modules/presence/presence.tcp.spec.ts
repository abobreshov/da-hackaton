/**
 * PresenceTcpController (EPIC-02).
 *
 * Wires the three presence TCP commands — `presence.touch`,
 * `presence.disconnect`, `presence.stateOf` — to the service.
 *
 * `stateOf` returns an object (`Record<userId, state>`) rather than a Map
 * because microservice JSON serialization doesn't preserve Map semantics.
 */

jest.mock('../../config/environment', () => ({
  env: {
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    AFK_THRESHOLD_SECONDS: 60,
  },
}));

import { PresenceTcpController } from './presence.tcp';
import type { PresenceService } from './presence.service';

function makeService(): jest.Mocked<PresenceService> {
  return {
    touch: jest.fn(),
    disconnect: jest.fn(),
    stateOf: jest.fn(),
    evaluate: jest.fn(),
  } as unknown as jest.Mocked<PresenceService>;
}

describe('PresenceTcpController', () => {
  let service: jest.Mocked<PresenceService>;
  let controller: PresenceTcpController;

  beforeEach(() => {
    service = makeService();
    controller = new PresenceTcpController(service);
  });

  it('presence.touch delegates to service.touch and returns { ok: true }', async () => {
    service.touch.mockResolvedValue(undefined);
    const out = await controller.touch({ userId: 1, sessionId: 'abc' });
    expect(service.touch).toHaveBeenCalledWith(1, 'abc');
    expect(out).toEqual({ ok: true });
  });

  it('presence.disconnect delegates to service.disconnect and returns { ok: true }', async () => {
    service.disconnect.mockResolvedValue(undefined);
    const out = await controller.disconnect({ userId: 1, sessionId: 'abc' });
    expect(service.disconnect).toHaveBeenCalledWith(1, 'abc');
    expect(out).toEqual({ ok: true });
  });

  it('presence.stateOf returns a plain object keyed by userId', async () => {
    service.stateOf.mockResolvedValue(
      new Map<number, 'online' | 'afk' | 'offline'>([
        [1, 'online'],
        [2, 'afk'],
        [3, 'offline'],
      ]),
    );

    const out = await controller.stateOf({ userIds: [1, 2, 3] });
    expect(service.stateOf).toHaveBeenCalledWith([1, 2, 3]);
    expect(out).toEqual({
      states: {
        1: 'online',
        2: 'afk',
        3: 'offline',
      },
    });
  });

  it('presence.stateOf with empty userIds returns empty map object', async () => {
    service.stateOf.mockResolvedValue(new Map());
    const out = await controller.stateOf({ userIds: [] });
    expect(out).toEqual({ states: {} });
  });

  it('presence.touch ignores extra _sys envelope field', async () => {
    service.touch.mockResolvedValue(undefined);
    await controller.touch({ userId: 1, sessionId: 'abc', _sys: 'key' } as any);
    expect(service.touch).toHaveBeenCalledWith(1, 'abc');
  });
});
