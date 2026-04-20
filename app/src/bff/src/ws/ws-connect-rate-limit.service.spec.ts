/**
 * WsConnectRateLimit — AC-14-12 WS connect rate-limit.
 *
 * Sliding-window Redis counter (ZADD + ZCARD) per user, 10 connects / 60 s.
 * Returns `{ ok, retryAfterMs }` so the caller (ChatGateway) decides what to
 * do on reject (close code 4429 + WireError emit). Fail-closed when Redis is
 * unreachable — protects the WS plane from resource exhaustion even if the
 * limiter itself falls over.
 */
import {
  WsConnectRateLimit,
  WS_CONNECT_LIMIT,
  WS_CONNECT_WINDOW_MS,
} from './ws-connect-rate-limit.service';

function buildPipeline(runAll: () => Promise<unknown>) {
  const pipeline: any = {
    zremrangebyscore: jest.fn().mockReturnThis(),
    zadd: jest.fn().mockReturnThis(),
    zcard: jest.fn().mockReturnThis(),
    pexpire: jest.fn().mockReturnThis(),
  };
  pipeline.exec = jest.fn(runAll);
  return pipeline;
}

function makeRedis(count: number, oldestTs = Date.now() - 1000) {
  const pipeline = buildPipeline(async () => [
    [null, 0],
    [null, 1],
    [null, count],
    [null, 1],
  ]);
  return {
    multi: () => pipeline,
    zrange: jest.fn().mockResolvedValue(['member', `${oldestTs}`]),
    _pipeline: pipeline,
  } as any;
}

describe('WsConnectRateLimit', () => {
  it('exposes the configured constants (10 / 60_000)', () => {
    expect(WS_CONNECT_LIMIT).toBe(10);
    expect(WS_CONNECT_WINDOW_MS).toBe(60_000);
  });

  it('allows when count is strictly under the limit', async () => {
    const redis = makeRedis(5);
    const svc = new WsConnectRateLimit(redis);
    await expect(svc.check(42)).resolves.toEqual({ ok: true });
    expect(redis._pipeline.zadd).toHaveBeenCalledWith(
      'ratelimit:wsconn:u:42',
      expect.any(Number),
      expect.any(String),
    );
  });

  it('allows when count equals the limit (10/10 is still ok — first rejected is the 11th)', async () => {
    const redis = makeRedis(10);
    const svc = new WsConnectRateLimit(redis);
    await expect(svc.check(42)).resolves.toMatchObject({ ok: true });
  });

  it('rejects when count exceeds the limit — returns retryAfterMs derived from oldest score', async () => {
    const now = Date.now();
    const oldest = now - 10_000;
    const redis = makeRedis(11, oldest);
    const svc = new WsConnectRateLimit(redis);

    const res = await svc.check(42);

    expect(res.ok).toBe(false);
    // retry-after = oldest + window - now ≈ 50_000 ± a few ms
    expect(res.retryAfterMs).toBeGreaterThan(0);
    expect(res.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('falls back to windowMs when zrange is empty on reject', async () => {
    const pipeline = buildPipeline(async () => [
      [null, 0],
      [null, 1],
      [null, 99],
      [null, 1],
    ]);
    const redis = {
      multi: () => pipeline,
      zrange: jest.fn().mockResolvedValue([]),
    } as any;

    const svc = new WsConnectRateLimit(redis);
    const res = await svc.check(42);

    expect(res.ok).toBe(false);
    expect(res.retryAfterMs).toBe(WS_CONNECT_WINDOW_MS);
  });

  it('fail-closed when Redis client is missing', async () => {
    const svc = new WsConnectRateLimit(undefined);
    const res = await svc.check(42);
    expect(res.ok).toBe(false);
    expect(res.retryAfterMs).toBeGreaterThan(0);
  });

  it('fail-closed when Redis pipeline throws (ECONNREFUSED)', async () => {
    const pipeline = buildPipeline(() => Promise.reject(new Error('ECONNREFUSED')));
    const redis = { multi: () => pipeline, zrange: jest.fn() } as any;

    const svc = new WsConnectRateLimit(redis);
    const res = await svc.check(7);
    expect(res.ok).toBe(false);
    expect(res.retryAfterMs).toBeGreaterThan(0);
  });

  it('fail-closed when pipeline.exec returns null (Redis hiccup)', async () => {
    const pipeline = buildPipeline(async () => null);
    const redis = { multi: () => pipeline, zrange: jest.fn() } as any;

    const svc = new WsConnectRateLimit(redis);
    const res = await svc.check(7);
    expect(res.ok).toBe(false);
  });

  it('uses per-userId namespaced key (isolates different users)', async () => {
    const redis = makeRedis(1);
    const svc = new WsConnectRateLimit(redis);
    await svc.check(101);
    expect(redis._pipeline.zadd).toHaveBeenCalledWith(
      'ratelimit:wsconn:u:101',
      expect.any(Number),
      expect.any(String),
    );
  });

  it('prunes entries outside the window (ZREMRANGEBYSCORE 0..windowStart)', async () => {
    const redis = makeRedis(1);
    const svc = new WsConnectRateLimit(redis);
    await svc.check(42);
    const call = redis._pipeline.zremrangebyscore.mock.calls[0];
    expect(call[0]).toBe('ratelimit:wsconn:u:42');
    expect(call[1]).toBe(0);
    expect(call[2]).toBeGreaterThan(0); // windowStart = now - windowMs
  });

  it('sets a TTL (pexpire) slightly over the window so abandoned buckets drop', async () => {
    const redis = makeRedis(1);
    const svc = new WsConnectRateLimit(redis);
    await svc.check(42);
    const call = redis._pipeline.pexpire.mock.calls[0];
    expect(call[0]).toBe('ratelimit:wsconn:u:42');
    expect(call[1]).toBeGreaterThanOrEqual(WS_CONNECT_WINDOW_MS);
  });
});
