# AI Herders Jam — Online Chat Server

Classic web chat (rooms + DMs + presence + files + moderation). Hackathon build.

---

## 1. Quick start

### 1.1 Prerequisites

- Docker + Docker Compose (v2)
- Node **22+**
- Corepack-enabled Yarn 4.9.1 (`corepack enable && corepack prepare yarn@4.9.1 --activate`)
- Free host ports: `3006` (BFF), `3007` (frontend), `8025` (Mailpit), `9999` (Dozzle) for `dev.sh`; `5433` + `6380` for `dev-local.sh`

Yarn 4 only — never `npm`.

### 1.2 First-time setup

```bash
cd app
yarn install
./scripts/gen-certs.sh        # mints dev CA + per-service mTLS certs
```

### 1.3 Boot

```bash
cd app
./dev.sh                      # full Docker stack
# or
./dev-local.sh                # infra in Docker, services on host
```

Stop with `Ctrl-C`. Recovery: `./dev-doctor.sh --clean` if ports get stuck.

### 1.4 URLs

| URL | Purpose |
|---|---|
| http://localhost:3007 | Frontend |
| http://localhost:3006/api/v1 | BFF |
| http://localhost:8025 | Mailpit — captures outgoing emails |
| http://localhost:9999 | Dozzle — container logs (`dev.sh` only) |

### 1.5 Seed credentials

| Email | Password | Role |
|---|---|---|
| `admin@example.com` | `Admin123!` | admin |
| `user@example.com` | `User1234!` | user |
| `user2fa@example.com` | `Secure2FA!` | user (2FA on — secret in `app/.seed-admin-totp.txt`) |

Re-seed: `yarn workspace @app/auth-service seed`.

---

## 2. Walkthrough — try it in 5 minutes

Three flows cover the core product surface. Boot the stack first (§1.3) and open Chrome + a second browser (or incognito) so you get independent cookie jars.

### 2.1 Register a fresh user

1. Open http://localhost:3007/register.
2. Fill **email**, **username** (immutable after signup), **password** — min 10 chars, mixed case + digit + symbol.
3. Submit → "Check your inbox" screen. No auto-login; email ownership must be proven first (OWASP V3.1.1).
4. Open http://localhost:8025 (Mailpit) → open the verification email → click **Verify my email**.
5. Redirects to `/dashboard`. You're in.

Retrying step 2 with the same email or username returns a 409 — uniqueness is enforced server-side.

### 2.2 Create a room + invite members

1. Log in as `admin@example.com` / `Admin123!`.
2. Go to `/rooms` → **+ New room** → name, description, visibility = **public** → **Create**.
3. Catalog at `/rooms` shows the room with name, description, member count.
4. In the second browser log in as `user@example.com` / `User1234!` → `/rooms` → click the public room → **Join**. Admin sees the membership update in the right-pane Members list within ~2 s (WS fan-out).
5. Private room variant: create another room with visibility = **private**. The user browser does **not** see it in the catalog. Admin → Manage Room → **Invitations** → invite by username (fail-silent per ADR-005: response is always `{queued:true}` whether the user exists or not).

### 2.3 Send a message (+ reply + edit + delete)

1. Both browsers on the same room page.
2. Admin types in the composer and sends → user's viewport receives the bubble within ~200 ms.
3. Multiline: Shift+Enter inside the composer preserves newlines. UTF-8 emoji paste (e.g. `🎉`) works; no in-composer picker. Hard cap 3 KB.
4. **Reply:** hover any bubble → **Reply** → composer shows quote chip → send. Reply renders with the quoted parent block above the bubble.
5. **Edit own message:** hover own bubble → **Edit** → change text → **Save**. Both sides see the "(edited)" indicator.
6. **Delete own message:** hover → **Delete** → confirm. Tombstone "This message was deleted" replaces the body on both sides.
7. **Admin cross-author delete:** in a room they admin, the admin's bubble toolbar exposes **Delete** on every user bubble. Same tombstone shows for everyone.
8. Scroll up to load older history — keyset pagination pulls the next 50 per scroll hit, no duplicates, no jank.

That's the happy path. DM is the same composer + bubble UI — pick a friend from `/contacts` and the thread mounts the same component tree.

---

## 3. Repo layout

```
hackathone/
├── app/                     yarn workspace root — boot + code lives here
│   ├── src/
│   │   ├── auth-service/    NestJS — JWT, 2FA, refresh tokens
│   │   ├── backend/         NestJS — domain tables (Drizzle ORM) + WS gateway
│   │   ├── bff/             NestJS — session cookies, CSRF, TCP proxy
│   │   ├── frontend/        React 19 + TanStack Router
│   │   └── packages/contracts/  shared DTOs
│   ├── e2e-tests/           Playwright + POM
│   ├── docker-compose.*.yml
│   └── dev.sh / dev-local.sh / dev-doctor.sh
├── mng/                     specs, architecture, ADRs
└── CLAUDE.md                session guidance for Claude Code
```

Stack + service-wiring details: `app/CLAUDE.md`.

---

## 4. Architecture

- **Component overview + transport choices + security boundaries:** [`mng/architecture/architecture.md`](mng/architecture/architecture.md)
- **Sequence diagrams** (auth / realtime / presence / attachments / moderation / rooms etc.):
  - Top-level mermaid diagrams inside `architecture.md`
  - Per-EPIC flow notes under [`mng/architecture/flow/`](mng/architecture/flow/)
- **Architecture Decision Records:** [`mng/architecture/adr/`](mng/architecture/adr/) (ADR-007 committed; ADR-001..006 summarised in `mng/implementation-status.md`).

Diagrams are authored in Mermaid — GitHub renders them natively, no build step required.

---

## 5. Scripts (`.sh`) — what a judge can run locally

All scripts live under `app/` (boot scripts) or `app/scripts/` (helpers). Run from `app/` unless noted.

### Boot + lifecycle

| Script | Purpose | Common flags |
|---|---|---|
| `./dev.sh` | Full Docker stack — auth-service, backend, BFF, frontend, Postgres, Redis, Mailpit, Dozzle. Hot-reload via `src/` bind mounts. `Ctrl-C` tears down. | `--build` (rebuild images), `--no-seed` (skip DB seed) |
| `./dev-local.sh` | Infra-only Docker (Postgres on `5433`, Redis on `6380`, Mailpit). All 4 services run on host via `yarn start:dev` / `yarn dev`. Logs land in `app/.dev-logs/*.log`. | `--skip-install`, `--skip-seed` |
| `./dev-doctor.sh` | Diagnose + free stuck dev-stack resources. Only touches processes whose cwd is inside `app/` — safe on a shared machine. | `--clean-services` (SIGTERM our node/nest/vite, keep infra), `--clean` (+ bring infra down), `--force` (SIGKILL), `--ports-only` |

### Setup + certs

| Script | Purpose | Common flags |
|---|---|---|
| `./scripts/gen-certs.sh` | Mint throwaway internal CA + per-service mTLS certs into `app/secrets/internal-ca/` (gitignored, 1-year expiry). Idempotent — re-run only regenerates when missing. | `--force` (rotate all), `--service-only <name>` (issue one more cert from existing CA) |

### Verification + observability

| Script | Purpose | Common flags |
|---|---|---|
| `./scripts/smoke.sh` | Reviewer-ready test gauntlet: build + unit-test every workspace, typecheck E2E, print a coloured summary table with per-workspace pass/fail counts. Exit 0 = all green. | `--skip-build`, `--skip-tests`, `--workspace=@app/<name>` |
| `./scripts/demo-verify.sh` | Automated demo-day verification: boots the stack, seeds, runs Playwright + k6, captures pass/fail + p95 latencies, writes a timestamped markdown report to `app/demo-reports/demo-verify-<ts>.md`. Auto-skips k6 if not installed. | `--use-local`, `--keep-data`, `--skip-e2e`, `--skip-load` |
| `./scripts/logs.sh` | Live-tail the dev-local stack logs under `app/.dev-logs/` with coloured `[service]` prefixes + `pino-pretty` formatting. Requires `./dev-local.sh`. | `--service=<auth-service\|backend\|bff\|frontend>`, `--filter='<grep pattern>'` |

### Load testing

| Script | Purpose | Common flags |
|---|---|---|
| `./load-tests/seed-load.sh` | Idempotent baseline seed for k6 scripts: ensures seed users + demo rooms exist. | `--register N` (also register N throwaway load-test users via `/api/v1/auth/register`) |

### Typical judge recipe

```bash
cd app
yarn install
./scripts/gen-certs.sh        # once
./dev.sh                      # boot — wait for "frontend → http://localhost:3007"
# (walk §2 in the browser)
# in another terminal:
./scripts/smoke.sh            # unit gauntlet
./scripts/demo-verify.sh      # boots + E2E + k6 + report
# if ports stick after Ctrl-C:
./dev-doctor.sh --clean
```

---

## 6. Further reading

- `mng/requirements/requirements.md` — hackathon brief.
- `mng/implementation-status.md` — per-EPIC progress + ADR index.
- `mng/specs/` — per-EPIC specs.
- `app/CLAUDE.md` — stack + service wiring + gotchas.

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `EADDRINUSE` on boot | `cd app && ./dev-doctor.sh --clean` (or `--force` if SIGTERM stalls) |
| Mailpit inbox empty | Check `app/.dev-logs/auth-service.log` for `SMTP_HOST`; confirm Mailpit container up |
| `TLS_ENABLED=true but cert files are missing` | `cd app && ./scripts/gen-certs.sh` |
| Playwright redis bleed | Handled — `e2e-tests/global-setup.ts` flushes Redis on each run |
| 2FA secret lost | `cat app/.seed-admin-totp.txt` |
| Stack won't tear down | `docker compose -f app/docker-compose.dev.yml down -v && docker compose -f app/docker-compose.infra.yml down -v` |
