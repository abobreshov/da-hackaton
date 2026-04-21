import IORedis from 'ioredis';

/**
 * Clears BFF rate-limit sorted sets before every Playwright run so the
 * login/register throttles (5/15min per email) don't cross-contaminate
 * test iterations. Also clears the presence keyspace so stale heartbeats
 * from a previous run don't leak into the fresh suite.
 *
 * Points at the dev-local infra by default (redis on 6380); override with
 * REDIS_HOST / REDIS_PORT envs if the stack moves.
 */
export default async function globalSetup(): Promise<void> {
  const host = process.env.REDIS_HOST ?? 'localhost';
  const port = Number(process.env.REDIS_PORT ?? 6380);
  const redis = new IORedis({ host, port, lazyConnect: true, maxRetriesPerRequest: 2 });
  try {
    await redis.connect();
  } catch (err) {
    console.warn(`[e2e:globalSetup] redis connect failed on ${host}:${port}`, err);
    return;
  }

  const patterns = ['ratelimit:*', 'presence:*'];
  for (const pattern of patterns) {
    const stream = redis.scanStream({ match: pattern, count: 500 });
    const pending: Promise<number>[] = [];
    for await (const keys of stream) {
      if (keys.length > 0) pending.push(redis.del(...keys));
    }
    await Promise.all(pending);
  }

  await redis.quit();
}
