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
│   └── specs/             features 01–15 + design-system (EPIC-13 deferred)
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
| auth-service | 3003 (dev-local only) | 4003 |
| backend | 3004 (dev-local only) | 4004 |
| bff | 3006 | — |
| frontend | 3007 | — |
| postgres | 5433 (dev-local) / 5432 | — |
| redis | 6380 (dev-local) / 6379 | — |

> `dev.sh` (Option A) keeps `auth-service` and `backend` internal — no host port. Only BFF and frontend are exposed. TCP ports stay internal on the compose network for inter-service mTLS.

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

**Fail-fast on missing certs.** When `TLS_ENABLED=true`, each service validates the existence of `TLS_CA_PATH`, `TLS_CERT_PATH`, and `TLS_KEY_PATH` at bootstrap. Missing files produce a single explicit error naming every path that's wrong:

```
TLS_ENABLED=true but cert files are missing: TLS_CERT_PATH=/certs/bff.crt. Run `./scripts/gen-certs.sh` in app/ or set TLS_ENABLED=false to skip mTLS.
```

This catches the common mistake of deleting `secrets/` without re-running `gen-certs.sh` — Docker would otherwise mount an empty directory and the service would crash with a cryptic `ENOENT`.

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

## Local vs production — what to configure / install

### Local (dev + hackathon demo)

**Install once:**

```bash
# Node 22+ via nvm, fnm, or distro package
corepack enable && corepack prepare yarn@4.9.1 --activate
# Docker Engine + docker-compose-plugin (v2)
```

**Per-run (from `app/`):**

```bash
./scripts/gen-certs.sh                # mint dev CA + per-service certs (first run only)
cp src/auth-service/.env.example src/auth-service/.env     # for dev-local.sh; compose has inline values
# repeat for backend / bff / frontend if you use dev-local.sh

# Option A — everything in Docker (recommended)
docker compose up --build             # reads docker-compose.yml (with Mailpit, TLS, SYSTEM_KEY)

# Option B — services on host, infra in Docker
./dev-local.sh                        # also launches Mailpit container via docker-compose.infra.yml
```

Dev secrets in `docker-compose.yml` are **intentional placeholders** so the stack runs out-of-the-box. Same values are written to `.env` files by `dev-local.sh` / regenerated with `openssl rand -hex 24`. `SYSTEM_KEY` must be identical across auth-service, backend, and bff.

**What you get locally:**

| URL | Purpose |
|---|---|
| http://localhost:3007 | Frontend |
| http://localhost:3006/api/v1 | BFF API |
| http://localhost:8025 | **Mailpit** — search + view captured emails, REST API for tests |
| http://localhost:9999 | Dozzle — container log viewer (Option A only) |

### Production — what changes

**Must provide (via your secret store — not committed):**

- `JWT_ADMIN_SECRET`, `JWT_CUSTOMER_SECRET`, `JWT_SECRET`, `COOKIE_SECRET`, `SESSION_COOKIE_SECRET` — each ≥ 32 chars, random, unique per env.
- `SYSTEM_KEY` — identical across the three services.
- `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT` — managed postgres + redis (RDS / Cloud SQL / Elasticache / Upstash etc).
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` — a real transactional SMTP (SES, SendGrid, Postmark, Mailgun). **Drop Mailpit.**
- `ALLOWED_ORIGINS` — your real frontend origin(s) with `https://`.
- `NODE_ENV=production` on every service — enables HSTS in Helmet, `Secure` cookie flag, Fastify `trustProxy`.

**mTLS certs:** the throwaway CA under `secrets/internal-ca/` is **dev-only**. In production, mint service certs from your own PKI (step-ca, HashiCorp Vault, cert-manager, AWS Private CA) and mount them read-only at `/certs/`. Set `TLS_ENABLED=true` plus the three `TLS_*_PATH` env vars per service. Rotate on a schedule.

**Infra changes:**

- Replace ephemeral postgres container with managed DB. Run `yarn workspace @app/backend db:migrate` + the auth seeder once on first deploy.
- Replace ephemeral redis with managed cache. Keep `maxmemory-policy allkeys-lru` or appropriate.
- Put the BFF behind an HTTPS-terminating reverse proxy (nginx, Caddy, ALB, Cloudflare). BFF itself speaks plain HTTP inside the cluster; TLS terminates at the edge.
- Disable Dozzle in production (`docker-compose.dev.yml` only). Use your logging stack (Loki, Datadog, CloudWatch).

**Security hardening unlocked by `NODE_ENV=production`:**

- HSTS header with `max-age=31536000; includeSubDomains; preload`.
- Session + refresh cookies get the `Secure` flag (HTTPS only).
- Fastify `trustProxy: true` so rate-limit + logs see the real client IP from `X-Forwarded-For`.
- Rate-limit loopback allowlist disabled.

**Operational checklist before going live:**

- [ ] All secrets pulled from a secret manager, not inline in compose / .env
- [ ] Real SMTP provider configured; Mailpit removed from compose
- [ ] Real internal-PKI certs; CA trust + expiry monitoring in place
- [ ] DB + redis: managed, backed up, TLS in-transit, network-restricted
- [ ] HTTPS terminator in front of BFF; HSTS preload enrolled
- [ ] Log aggregation + alerting (liveness + 5xx rate + auth failure spike)
- [ ] Seed data removed from prod DB

## Further reading

- `CLAUDE.md` — project-root guidance for Claude Code sessions.
- `app/CLAUDE.md` — stack, service wiring, auth flow, gotchas.
- `mng/README.md` — specs index.
- `mng/requirements/` — official hackathon brief.
- `mng/specs/12-deployment.md` — deployment spec (EPIC-12).
- `mng/specs/14-security-nfrs.md` — security NFRs.
