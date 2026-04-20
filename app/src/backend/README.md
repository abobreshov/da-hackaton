# @app/backend

NestJS domain service — Drizzle ORM over Postgres, TCP microservice for BFF, Redis/BullMQ for queues. Validates tokens by TCP-calling `auth-service`.

See `app/CLAUDE.md` for the cross-service architecture.

## Testing

Unit and integration tests are separated to keep the default `yarn test` fast and offline.

- `yarn workspace @app/backend test` — **unit tests** only (`*.spec.ts`). No Docker, no DB, no network.
- `yarn workspace @app/backend test:int` — **integration tests** (`*.int-spec.ts`). Spins up ephemeral Postgres 16 + Redis 7 via [Testcontainers](https://node.testcontainers.org/), applies all Drizzle migrations in `drizzle/`, and runs the specs against those. Requires a reachable Docker daemon; no `docker-compose` stack needs to be up.

Harness entry point: `src/test/integration-harness.ts` — exports `startTestDb()`, `startTestRedis()`, `startTestStack()`. Containers are cached per Jest worker and torn down via `globalTeardown`.

To write a new integration spec, name it `foo.int-spec.ts` and call `startTestStack()` (or `startTestDb()` / `startTestRedis()` individually):

```ts
import { startTestStack } from './test/integration-harness';

it('does a thing', async () => {
  const { db, redis } = await startTestStack();
  // db.drizzle, db.pool, redis.client are ready
});
```
