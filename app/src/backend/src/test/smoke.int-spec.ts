/**
 * Integration smoke test — proves Testcontainers harness starts Postgres +
 * Redis, applies Drizzle migrations, and that both stores are usable.
 *
 * Run with: yarn workspace @app/backend test:int -- smoke
 */

import { startTestStack } from './integration-harness';

describe('integration harness smoke', () => {
  it('starts postgres, applies migrations, and redis SET/GET works', async () => {
    const { db, redis } = await startTestStack();

    // Postgres reachable
    const pong = await db.pool.query('SELECT 1 AS ok');
    expect(pong.rows[0].ok).toBe(1);

    // Migration 0000 applied → password_resets exists
    const tables = await db.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1`,
      ['password_resets'],
    );
    expect(tables.rowCount).toBe(1);

    // Redis SET/GET roundtrip
    await redis.client.set('harness:key', 'hello');
    const value = await redis.client.get('harness:key');
    expect(value).toBe('hello');
  }, 60_000);
});
