# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Project root is one level up (`..`). Git repo, root `CLAUDE.md`, `mng/` specs, and `.claude/agents/` live there. This file covers stack + service details.

## Package Manager

Yarn 4.9.1 via corepack. **Never use npm.** Scripts, Dockerfiles, and CI all use yarn. Enable with `corepack enable && corepack prepare yarn@4.9.1 --activate`.

## Running the stack

Two supported workflows:

- **`./dev.sh`** — all 4 services + infra in Docker (`docker-compose.dev.yml`). Services have hot-reload via bind mounts (`src/` only). Host ports: `3006` (BFF), `3007` (frontend). `postgres`/`redis` are NOT published to host by default; `docker-compose.override.yml` uses `!reset []` to drop those bindings and also mounts `tsconfig.base.json` into each NestJS container because standalone service tsconfigs extend `../../tsconfig.base.json`, which resolves to `/tsconfig.base.json` inside `/app`.
- **`./dev-local.sh`** — only postgres + redis in Docker (`docker-compose.infra.yml`, host ports `5433`/`6380` to avoid clashes). All 4 services run on host via `yarn start:dev` / `yarn dev`. Script exports `DATABASE_URL` / `REDIS_HOST` / `REDIS_PORT` to override each service's `.env`. Logs go to `.dev-logs/*.log`. Flags: `--skip-install`, `--skip-seed`.

Seed creds (inserted by `src/auth-service/scripts/seed.ts`):

```
admin@example.com     Admin123!     admin, no 2FA
user@example.com      User1234!     user, no 2FA
user2fa@example.com   Secure2FA!    user, 2FA ON (TOTP secret regenerated on each seed)
```

## Architecture

Four services, **all inter-service calls are NestJS microservices over TCP** except BFF↔frontend (HTTP + cookies):

```
Browser --HTTP+cookies-->  BFF (3006)
                             |
                             |-- TCP 4003 --> auth-service (HTTP 3003 + TCP 4003)
                             \-- TCP 4004 --> backend (HTTP 3004 + TCP 4004)
                                                 |
                                                 \-- TCP 4003 --> auth-service (validateToken)
```

- **`auth-service`** — credentials, JWT issuance, refresh-token Redis store (`refresh:{u|a}:{id}:{hash}`), TOTP. Hybrid HTTP + TCP app bootstrapped in `src/main.ts` via `connectMicroservice` + `startAllMicroservices`. Domain logic lives in `*AuthService`; HTTP + TCP controllers both delegate to the same service. TCP controllers live in `modules/auth/{admin,customer}/*.tcp.ts` and wrap service calls with `common/rpc-exception.util.ts#toRpc` which converts `HttpException` → `RpcException({ status, message })`.
- **`backend`** — domain tables via Drizzle ORM. `jwt.guard.ts` validates bearer tokens by TCP-calling auth-service `auth.customer.validateToken`. TCP server bootstrap is in `src/microservice.ts`.
- **`bff`** — thin proxy, owns browser session cookies, no database. Uses two TCP `ClientProxy`s registered in `common/microservice.module.ts` (`AUTH_SERVICE` → 4003, `BACKEND_SERVICE` → 4004). `RpcErrorInterceptor` (global in `main.ts`) maps RpcException status → HTTP exception classes.
- **`frontend`** — React 19 + TanStack Router. All fetches go through `lib/api-client.ts` with `credentials: 'include'`. Vite proxies `/api` + `/auth` to BFF at `3006`. `routeTree.gen.ts` is **hand-written** (no tanstack router vite plugin configured) — use `.update({ id, path, getParentRoute })` pattern, **not** `rootRoute.addChildren([...])` (causes `Duplicate routes __root__` error).

### Auth flow specifics

- **Cookies are two-layer**: `@fastify/cookie` HMAC-signs the raw value (`COOKIE_SECRET`), and the value itself is a JWT signed with `SESSION_COOKIE_SECRET`. See `bff/src/auth/cookie.service.ts`.
- **Session refresh is transparent**: `SessionGuard` fast-path verifies session cookie; slow-path calls auth-service refresh via TCP and re-sets both cookies.
- **2FA is a structured response, not an error.** When `user.twoFactorEnabled && !totpCode`, auth-service returns `{ requires2fa: true }` (not a 401). BFF `auth.controller.ts` forwards it; frontend `routes/login.tsx` branches on `'requires2fa' in result` to render the TOTP step. Do not re-introduce 401 + message-string matching.
- **Admin login UI is intentionally hidden** — `login.tsx` renders only the user flow (single email+password step, TOTP as step 2 when required).

## Common commands

```bash
yarn install                          # root (yarn 4 workspaces)
yarn workspace @app/auth-service seed # reseed DB
yarn workspace @app/frontend dev      # run just one service
yarn workspace @app/backend db:generate  # drizzle migrations
yarn workspace @app/backend db:migrate
yarn workspace @app/tests test        # e2e suite (after dev-local.sh or dev.sh)
```

E2E tests (`e2e-tests/` — Playwright + POM): page objects in `pages/`, fixtures in `fixtures/test.ts`, specs in `e2e/`. Target `BASE_URL` env var (default `http://localhost:3007`). First run: `yarn workspace @app/tests install:browsers`.

## OpenViking memory plugin

`.claude/settings.json` wires SessionStart / UserPromptSubmit / Stop / SessionEnd hooks into `claude-memory-plugin/hooks/*.sh` (Python bridge via `~/.openviking-venv`). Skills `memory-recall`, `ov-search`, `ov-ingest`, `review`, `grill-me` are in `.claude/skills/`. `ov.conf` holds the OpenAI key — gitignored along with `data/` and `.openviking/`. Storage is per-project (`./data/viking`), so memories don't leak across repos.

## Gotchas

- NestJS services run `tsc --watch`. When adding a package, also install it inside the running container (or rebuild) — `docker-compose.dev.yml` mounts only `src/` ro, so `node_modules` baked into the image is what actually runs. `@nestjs/microservices` is required in auth-service (not just bff/backend).
- Decorators are legacy (`experimentalDecorators: true, emitDecoratorMetadata: true` in `tsconfig.base.json`). If you see TS1241/TS1270/TS1206 errors, the base tsconfig is not being found — check the `/tsconfig.base.json` mount in `docker-compose.override.yml`.
- JWT `expiresIn` accepts a string like `'15m'` but `@nestjs/jwt` strict types reject it; cast the options object `as any` (see `auth-service/src/modules/auth/shared/jwt.service.ts`).
- `.env` files are per-service (load order in `dev-local.sh`: file first, then script-exported overrides win). The docker-compose files set env inline and ignore the `.env` files.
