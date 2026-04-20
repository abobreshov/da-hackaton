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

### Inter-service mTLS — first run only

Services talk to each other over TCP with mutual TLS + a shared `SYSTEM_KEY` envelope. Generate a throwaway dev CA + per-service certs before the first `./dev.sh` or `./dev-local.sh`:

```bash
cd app
./scripts/gen-certs.sh          # creates ./secrets/internal-ca/{ca,auth-service,backend,bff}.{crt,key}
./scripts/gen-certs.sh --force  # rotate everything
./scripts/gen-certs.sh --service-only <name>   # issue one more cert from the existing CA
```

Output directory is gitignored. Certs are 1-year, IPs 127.0.0.1 + ::1 + DNS `<svc>.internal`/`<svc>`/`localhost`. `dev-local.sh` runs the generator automatically if `ca.crt` is missing.

### Environment files

Each service reads its config from a gitignored `.env` at the service root. Create them before booting the stack:

| File | Required vars (all secrets ≥ 32 chars) |
|---|---|
| `src/auth-service/.env` | `JWT_ADMIN_SECRET`, `JWT_CUSTOMER_SECRET`, `SYSTEM_KEY`, `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT` |
| `src/bff/.env` | `JWT_SECRET`, `SESSION_COOKIE_SECRET`, `COOKIE_SECRET`, `SYSTEM_KEY`, `AUTH_TCP_HOST`, `BACKEND_TCP_HOST` |
| `src/backend/.env` | `SYSTEM_KEY`, `DATABASE_URL`, `AUTH_TCP_HOST` |
| `src/frontend/.env` | `VITE_BFF_URL=http://localhost:3006` |

`SYSTEM_KEY` must be identical across auth-service, backend, and bff — it authenticates inter-service RPC calls alongside mTLS. `dev-local.sh` also sets `TLS_ENABLED=true`, `TCP_BIND=127.0.0.1`, and the `TLS_*_PATH` env vars automatically from `./secrets/internal-ca/`.

### Running on alternate ports (port-in-use fallback)

If `./dev-doctor.sh` reports an orphan `docker-proxy` on `3006` / `3007` that you can't `sudo kill`, bring the stack up on spare ports instead:

```bash
# app/src/bff/.env
PORT=13006
ALLOWED_ORIGINS=http://localhost:13007

# app/src/auth-service/.env
ALLOWED_ORIGINS=http://localhost:13007

# app/src/frontend/.env
VITE_PORT=13007
VITE_BFF_URL=http://localhost:13006
BFF_URL=http://localhost:13006
```

`vite.config.ts` honors `VITE_PORT` / `BFF_URL` / `VITE_BFF_URL`. Run Playwright with `BASE_URL=http://localhost:13007 yarn workspace @app/tests test`. Revert the `.env` values once the canonical ports are free.

Generate dev secrets quickly:

```bash
for f in src/auth-service src/bff src/backend; do
  echo "# generated $(date -Iseconds)" > "$f/.env"
done
# then fill each required key with: openssl rand -hex 24
```

`dev-local.sh` injects `DATABASE_URL` / `REDIS_HOST` / `REDIS_PORT` itself, so those can be omitted in Option B. `dev.sh` reads inline env from the docker-compose files and ignores service `.env` entirely.

> **Note on `docker compose up`.** Compose files live under `app/` (not repo root). Run `cd app && ./dev.sh` or `cd app && docker compose -f docker-compose.dev.yml up` to bring the stack up. Top-level `docker compose up` will not resolve services.

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

### Debug stuck resources — `./dev-doctor.sh`

When a previous run leaves stale processes or `docker-proxy` orphans pinning host ports (symptom: `EADDRINUSE` on `dev-local.sh`), use the doctor script.

```bash
cd app
./dev-doctor.sh                    # read-only: shows port owners + hackathone processes
./dev-doctor.sh --clean-services   # SIGTERM our node/nest/vite procs, keep postgres+redis up
./dev-doctor.sh --clean            # SIGTERM services + docker infra down
./dev-doctor.sh --force            # SIGKILL stubborn procs + infra down
./dev-doctor.sh --ports-only       # re-check ports after cleanup
```

Only processes whose cwd is inside `app/` are touched — the script is safe next to unrelated Node / Docker workloads.

If a port shows `(docker-proxy orphan — stop with: sudo kill …)`, it means a previous `dev.sh` docker stack was removed but its port-forward proxies survived. Run the listed `sudo kill`, or `sudo systemctl restart docker` to clear.

## Quality checks

Monorepo-wide scripts (run from `app/`):

```bash
yarn typecheck     # tsc --noEmit across all services
yarn build         # production builds (NestJS dist, Vite bundle)
yarn test          # unit tests (Jest for NestJS, Vitest for frontend)
yarn lint          # ESLint 9 flat config
yarn lint:fix      # ESLint with autofix
yarn format        # Prettier write
yarn format:check  # Prettier verify
```

Per-service scripts (in addition to `build`, `start`, `start:dev`):

| Service | test | test:watch | test:cov | typecheck |
|---|---|---|---|---|
| `@app/auth-service` | Jest | ✓ | ✓ | ✓ |
| `@app/backend` | Jest | ✓ | ✓ | ✓ |
| `@app/bff` | Jest | ✓ | ✓ | ✓ |
| `@app/frontend` | Vitest | ✓ | ✓ (v8) | ✓ |

Unit-test layout: colocated `*.spec.ts` (NestJS) or `*.test.ts` (frontend) next to the file under test.

### E2E tests (Playwright)

E2E specs live at `app/e2e-tests/` (separate `@app/tests` workspace, POM pattern under `pages/`, fixtures in `fixtures/test.ts`).

```bash
cd app
yarn workspace @app/tests install:browsers   # first run only
yarn workspace @app/tests test               # after dev.sh or dev-local.sh is up
yarn workspace @app/tests report             # open last HTML report
```

Login UI is user-only — the admin flow is hidden at the frontend (see `app/CLAUDE.md`). E2E covers: successful user login, invalid credentials, client-side validation.

## Further reading

- `CLAUDE.md` — project-root guidance for Claude Code sessions.
- `app/CLAUDE.md` — stack, service wiring, auth flow, gotchas.
- `mng/README.md` — specs index.
- `mng/requirements/` — official hackathon brief.
