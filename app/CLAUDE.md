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

## Troubleshooting stuck dev stack — `./dev-doctor.sh`

`EADDRINUSE` on startup almost always means one of:

1. A previous `dev.sh` docker stack was removed but its `docker-proxy` processes still forward 3006/3007 to a dead container IP.
2. A prior `dev-local.sh` run exited without cleanup (Ctrl-C inside Claude Code session, crashed watcher).

Run the doctor to identify + fix:

```bash
./dev-doctor.sh                    # report-only
./dev-doctor.sh --clean-services   # kill only our hackathone node/nest/vite processes, keep postgres + redis
./dev-doctor.sh --clean            # + `docker compose -f docker-compose.infra.yml down`
./dev-doctor.sh --force            # SIGKILL after SIGTERM failed
```

The script only touches PIDs whose `/proc/$pid/cwd` is rooted under `app/`, so it is safe on a shared box. If a port belongs to an orphan `docker-proxy` (root-owned, invisible to us), the report emits the exact `sudo kill <pids>` to run — or `sudo systemctl restart docker` to clear all proxy leftovers.

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

Plugin code lives here (`app/claude-memory-plugin/`) but `.claude/settings.json`, `.openviking/`, `data/`, and `ov.conf` all live at the **project root** (`..`). Hook paths use `$CLAUDE_PROJECT_DIR/app/claude-memory-plugin/hooks/*.sh` so Claude must be launched from the project root. Skills `memory-recall`, `ov-search`, `ov-ingest`, `review`, `grill-me` are in `../.claude/skills/`. Python bridge via `~/.openviking-venv`. `ov.conf` holds the OpenAI key — gitignored along with `data/` and `.openviking/`. Storage is per-project (`../data/viking`).

## Inter-service security (auth-service ↔ backend ↔ bff)

Two independent defenses on every RPC:

1. **Shared-secret envelope.** Every client `.send(pattern, payload)` wraps the payload with `withSys({...})` (see `src/*/src/common/rpc-transport.ts`). The server-side `SystemKeyRpcGuard` runs as `APP_GUARD` on auth-service and backend, validates `payload._sys === env.SYSTEM_KEY`, and throws `RpcException({ status: 401 })` otherwise. HTTP controllers are exempt via `ctx.getType() !== 'rpc'` early return.
2. **Mutual TLS.** When `TLS_ENABLED=true`, `buildTcpMicroserviceOptions` / `buildTcpClientOptions` pass `tlsOptions` with `ca`, `cert`, `key`, `requestCert: true`, `rejectUnauthorized: true`. Certs are issued by a throwaway internal CA under `./secrets/internal-ca/` (gitignored). Regenerate via `./scripts/gen-certs.sh` (`--force` to rotate, `--service-only` to add one).

Listeners bind to `127.0.0.1` by default via `TCP_BIND` — nothing on the LAN can reach 4003/4004. Docker sets `TCP_BIND=0.0.0.0` because containers talk over the internal network.

**Important side effect:** auth-service's `ValidationPipe` uses `{ whitelist: true, transform: true }` (no `forbidNonWhitelisted`) so the `_sys` key is silently stripped after the guard reads it. Do not re-enable `forbidNonWhitelisted` there or every RPC call will fail validation.

Why not just CSP/rate-limit/OriginGuard at the BFF? Those only protect the browser-facing boundary. An attacker who lands on the host (prod bastion, developer laptop, LAN) could otherwise call `auth.customer.validateToken` or `auth.admin.login` directly on port 4003 and bypass the BFF entirely — that's what this layer closes.

## Frontend design system — binding

Visual language is locked down by **`mng/specs/design-system.md`** ("The Kinetic Playground"). Applies to every file under `src/frontend/`. Fluid, bouncy, lounge energy — not a dashboard.

Hard rules (PR-rejecting):

- No 1 px solid borders for sectioning. Separate regions with `surface_container_low` → `surface` → `surface_container_high` tier shifts.
- No `<hr>` / horizontal dividers. Tonal shifts + whitespace only.
- No raw hex literals in components — every colour comes from a token in `tailwind.config.ts`.
- No pure-grey shadows. Tint with `on_surface` (`#39264c`) at 4–8% opacity, blur 30–60 px, diffuse.
- No rigid-grid alignment — intentional off-axis drift and avatar overlap are features, not bugs.
- Plus Jakarta Sans for `display-*`, `headline-*`, `title-*`. Be Vietnam Pro for `body-*`, `label-*`. Strategy: extreme scale contrast (`display-md` paired with `body-md`).
- Primary buttons: full round (`9999px`), gradient `primary` → `primary_dim`, hover scale `1.02x`.
- Chat bubbles — signature component:
  - "Me" → `primary` bg, "Them" → `surface_container_high` bg.
  - Asymmetric rounding: `xl` (3 rem) on three corners, `sm` (0.5 rem) on the corner nearest the avatar. Speech-tail effect without literal triangles.
- Inputs: `surface_container_low` bg, no default border, focus = `primary` ghost border at 20% + ambient glow.
- Cards: `lg` (2 rem) corner radius. Chips: pill (`full`), `tertiary_container` for accents.

When editing or adding UI primitives under `src/frontend/src/components/ui/`, consult the spec first. Token gaps (missing Tailwind utility for a surface tier, missing font scale) are additions to `tailwind.config.ts`, not exceptions to the rules.

**shadcn/ui pattern:** primitives are copy-pasted into `src/frontend/src/components/ui/*` — not imported from an npm theme library. Radix (`@radix-ui/react-*`) handles behaviour + a11y; we own the surface and re-theme to Kinetic Playground tokens. Variant API via `cva` + `clsx` + `tailwind-merge` (already in deps). Standard shape: `Button(variant, size)`, `Input(variant)`. `npx shadcn add` is allowed for pulling *new* primitives but the generated file must be immediately retheme-d (strip greys, replace default borders with tonal shifts, swap to token utilities) before commit.

## Gotchas

- NestJS services run `tsc --watch`. When adding a package, also install it inside the running container (or rebuild) — `docker-compose.dev.yml` mounts only `src/` ro, so `node_modules` baked into the image is what actually runs. `@nestjs/microservices` is required in auth-service (not just bff/backend).
- Decorators are legacy (`experimentalDecorators: true, emitDecoratorMetadata: true` in `tsconfig.base.json`). If you see TS1241/TS1270/TS1206 errors, the base tsconfig is not being found — check the `/tsconfig.base.json` mount in `docker-compose.override.yml`.
- JWT `expiresIn` accepts a string like `'15m'` but `@nestjs/jwt` strict types reject it; cast the options object `as any` (see `auth-service/src/modules/auth/shared/jwt.service.ts`).
- `.env` files are per-service (load order in `dev-local.sh`: file first, then script-exported overrides win). The docker-compose files set env inline and ignore the `.env` files.
