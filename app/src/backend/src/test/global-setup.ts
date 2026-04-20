/**
 * Jest globalSetup — boots the Testcontainers stack once for the whole
 * integration run and exports connection info via env vars so individual
 * specs can discover it.
 */

import { startTestStack } from './integration-harness';

export default async function globalSetup(): Promise<void> {
  const { db, redis } = await startTestStack();
  process.env.TEST_DATABASE_URL = db.connectionString;
  process.env.TEST_REDIS_HOST = redis.host;
  process.env.TEST_REDIS_PORT = String(redis.port);
  process.env.TEST_REDIS_URL = redis.url;
}
