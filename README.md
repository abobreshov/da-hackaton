# AI Herders Jam — Hackathon Project

Project root. Implementation lives under `app/` (yarn 4 monorepo, NestJS services + React 19 frontend, PostgreSQL + Redis).

## Layout

```
hackathone/
├── .claude/               agents, skills, settings (project-wide)
├── app/                   implementation (yarn workspace root)
│   ├── src/
│   │   ├── auth-service/  NestJS — JWT + 2FA
│   │   ├── backend/       NestJS — domain + Drizzle ORM
│   │   ├── bff/           NestJS — BFF session cookies
│   │   ├── frontend/      React 19 + TanStack Router
│   │   └── packages/      shared
│   ├── e2e-tests/         Playwright
│   ├── claude-memory-plugin/
│   ├── docker-compose.*.yml
│   └── dev.sh / dev-local.sh
├── docs/                  project-wide docs
├── mng/                   specs, architecture, requirements
│   ├── architecture/
│   ├── requirements/      official requirements PDF
│   └── specs/             features 01–13
├── CLAUDE.md              guidance for Claude Code (root)
└── README.md              this file
```

## Stack

| Layer | Tech |
|---|---|
| auth-service | NestJS 11 + Fastify 5 |
| backend | NestJS 11 + Fastify 5 |
| bff | NestJS 11 + Fastify 5 |
| frontend | React 19 + TanStack Router |
| Database | PostgreSQL 16 |
| Cache / Queue | Redis 7 |
| Package mgr | Yarn 4.9.1 (corepack) — **never npm** |

## Ports

| Service | HTTP | TCP |
|---|---|---|
| auth-service | 3003 | 4003 |
| backend | 3004 | 4004 |
| bff | 3006 | — |
| frontend | 3007 | — |
| postgres | 5433 (dev-local) / 5432 | — |
| redis | 6380 (dev-local) / 6379 | — |

## Run locally

### Prerequisites

- Docker + Docker Compose
- Node **22+**
- Corepack (ships with Node 16+); enable yarn 4:
  ```bash
  corepack enable
  corepack prepare yarn@4.9.1 --activate
  ```
- For `dev-local.sh`: host ports `5433` (postgres) and `6380` (redis) free.
- For `dev.sh`: host ports `3006` (bff) and `3007` (frontend) free.

### Install

```bash
cd app
yarn install
```

### Option A — full stack in Docker (recommended)

All 4 services + postgres + redis run in containers. Hot-reload via `src/` bind mounts.

```bash
cd app
./dev.sh              # foreground, Ctrl-C tears down
./dev.sh --build      # rebuild images first
./dev.sh --no-seed    # skip DB seeding
```

### Option B — infra in Docker, services on host

Only postgres + redis in Docker. Services run via `yarn start:dev` / `yarn dev` on host. Faster reloads, logs in `app/.dev-logs/*.log`.

```bash
cd app
./dev-local.sh
./dev-local.sh --skip-install --skip-seed
```

### Access

| URL | Service |
|---|---|
| http://localhost:3007 | frontend |
| http://localhost:3006 | BFF (API) |
| http://localhost:3003 | auth-service (Option B only) |
| http://localhost:3004 | backend (Option B only) |

### Seed credentials

Inserted by `src/auth-service/scripts/seed.ts`:

| Email | Password | Role | 2FA |
|---|---|---|---|
| admin@example.com | Admin123! | admin | off |
| user@example.com | User1234! | user | off |
| user2fa@example.com | Secure2FA! | user | on |

Re-seed anytime: `yarn workspace @app/auth-service seed` (Option B) or `docker compose -f app/docker-compose.dev.yml exec auth-service yarn seed` (Option A).

### Stop / reset

```bash
cd app
docker compose -f docker-compose.dev.yml down          # Option A stop
docker compose -f docker-compose.dev.yml down -v       # + wipe volumes (fresh DB)
docker compose -f docker-compose.infra.yml down        # Option B stop
```

### E2E tests

```bash
cd app
yarn workspace @app/tests install:browsers   # first run only
yarn workspace @app/tests test               # after dev.sh or dev-local.sh is up
```

## Further reading

- `CLAUDE.md` — project-root guidance for Claude Code sessions.
- `app/CLAUDE.md` — stack, service wiring, auth flow, gotchas.
- `mng/README.md` — specs index.
- `mng/requirements/` — official hackathon brief.
