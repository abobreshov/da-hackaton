/**
 * Integration test harness — Testcontainers-backed Postgres + Redis.
 *
 * Spins up ephemeral containers per Jest worker, applies Drizzle migrations
 * against Postgres, and exposes connection handles. Designed to run without
 * the docker-compose dev stack being up.
 *
 * Containers are cached on `globalThis` so repeated calls to `startTestStack()`
 * in the same worker reuse the same instances. Jest `globalSetup` /
 * `globalTeardown` drive the lifecycle for the whole suite.
 */

import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool, PoolClient } from 'pg';
import Redis from 'ioredis';
import * as path from 'path';
import * as schema from '../database/schema';

export interface TestDb {
  connectionString: string;
  pool: Pool;
  client: PoolClient;
  drizzle: NodePgDatabase<typeof schema>;
  teardown: () => Promise<void>;
}

export interface TestRedis {
  host: string;
  port: number;
  url: string;
  client: Redis;
  teardown: () => Promise<void>;
}

export interface TestStack {
  db: TestDb;
  redis: TestRedis;
  teardown: () => Promise<void>;
}

interface CacheSlot {
  pgContainer?: StartedPostgreSqlContainer;
  redisContainer?: StartedRedisContainer;
  db?: TestDb;
  redis?: TestRedis;
}

// Cached per Node process (i.e. per Jest worker).
const CACHE_KEY = Symbol.for('@app/backend:test:integration-harness');
type CacheHost = typeof globalThis & { [CACHE_KEY]?: CacheSlot };
const cache: CacheHost = globalThis as CacheHost;
if (!cache[CACHE_KEY]) cache[CACHE_KEY] = {};
const slot: CacheSlot = cache[CACHE_KEY]!;

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'drizzle');

/**
 * Create `users` + enum types that the `backend` migrations FK against.
 *
 * In production these are owned by `auth-service`; backend migrations assume
 * they already exist. We replicate the minimal DDL needed for FK targets so
 * `password_resets`, `user_sessions`, `friendships`, `user_bans`, etc. can be
 * created against a brand-new container.
 */
async function bootstrapAuthOwnedSchema(pool: Pool): Promise<void> {
  const sql = `
    DO $$ BEGIN
      CREATE TYPE role AS ENUM ('ADMIN', 'USER');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE access_status AS ENUM ('ACTIVE', 'INACTIVE');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL DEFAULT '',
      role role DEFAULT 'USER',
      scopes TEXT[] NOT NULL DEFAULT '{}',
      two_factor_enabled BOOLEAN DEFAULT FALSE,
      two_factor_secret TEXT,
      access_status access_status DEFAULT 'ACTIVE',
      deleted_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL DEFAULT '',
      two_factor_enabled BOOLEAN DEFAULT FALSE,
      two_factor_secret TEXT,
      access_status access_status DEFAULT 'ACTIVE',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `;
  await pool.query(sql);
}

/**
 * Start (or reuse) a Postgres container, apply all Drizzle migrations.
 */
export async function startTestDb(): Promise<TestDb> {
  if (slot.db) return slot.db;

  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('appdb_test')
    .withUsername('test')
    .withPassword('test')
    .start();
  slot.pgContainer = container;

  const connectionString = container.getConnectionUri();
  const pool = new Pool({ connectionString });
  await bootstrapAuthOwnedSchema(pool);

  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  const client = await pool.connect();

  const teardown = async (): Promise<void> => {
    try {
      client.release();
    } catch {
      /* noop */
    }
    try {
      await pool.end();
    } catch {
      /* noop */
    }
    try {
      await container.stop({ timeout: 5 });
    } catch {
      /* noop */
    }
    slot.db = undefined;
    slot.pgContainer = undefined;
  };

  slot.db = { connectionString, pool, client, drizzle: db, teardown };
  return slot.db;
}

/**
 * Start (or reuse) a Redis container.
 */
export async function startTestRedis(): Promise<TestRedis> {
  if (slot.redis) return slot.redis;

  const container = await new RedisContainer('redis:7-alpine').start();
  slot.redisContainer = container;

  const host = container.getHost();
  const port = container.getMappedPort(6379);
  const url = `redis://${host}:${port}`;
  const client = new Redis({ host, port, lazyConnect: false, maxRetriesPerRequest: 3 });

  const teardown = async (): Promise<void> => {
    try {
      await client.quit();
    } catch {
      try {
        client.disconnect();
      } catch {
        /* noop */
      }
    }
    try {
      await container.stop({ timeout: 5 });
    } catch {
      /* noop */
    }
    slot.redis = undefined;
    slot.redisContainer = undefined;
  };

  slot.redis = { host, port, url, client, teardown };
  return slot.redis;
}

/**
 * Convenience: start both Postgres + Redis in parallel.
 * Returned `teardown` stops both.
 */
export async function startTestStack(): Promise<TestStack> {
  const [db, redis] = await Promise.all([startTestDb(), startTestRedis()]);
  const teardown = async (): Promise<void> => {
    await Promise.allSettled([db.teardown(), redis.teardown()]);
  };
  return { db, redis, teardown };
}

/**
 * Force full teardown — used by Jest globalTeardown.
 */
export async function stopTestStack(): Promise<void> {
  const tasks: Array<Promise<void>> = [];
  if (slot.db) tasks.push(slot.db.teardown());
  if (slot.redis) tasks.push(slot.redis.teardown());
  await Promise.allSettled(tasks);
}
