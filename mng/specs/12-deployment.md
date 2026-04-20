# EPIC-12 — Deployment

**Req refs:** §7

## Goal
Public GitHub repo; `docker compose up` in root folder builds and runs whole app.

## Scope

- SMTP service (MailHog for dev/MVP) for password-reset emails (EPIC-01)
- Dozzle (Docker log viewer) for observability — log streams from all services via Docker socket
- Demo seed rooms: seed script creates public rooms #general, #random, #demo with sample messages for reviewer walkthrough

## Services (docker-compose)

| Service | Image | Host port | Purpose |
|---|---|---|---|
| frontend | local build | 3007 | React app |
| bff | local build | 3006 | session + WS + REST |
| auth-service | local build | — | JWT, 2FA, reset emails |
| backend | local build | — | domain + Drizzle |
| postgres | postgres:16 | 5432 | DB |
| redis | redis:7 | 6379 | cache + pub/sub + BullMQ |
| mailhog | mailhog/mailhog | 1025 (smtp), 8025 (ui) | dev SMTP capture |
| dozzle | amir20/dozzle | 9999 | log viewer |

Env additions (docker-compose + service .env):
- SMTP_HOST=mailhog SMTP_PORT=1025 SMTP_FROM=noreply@local
- ALLOWED_WS_ORIGINS=http://localhost:3007
- MESSAGE_RETENTION_DAYS=365 ATTACHMENT_RETENTION_DAYS=365 AUDIT_LOG_RETENTION_DAYS=365 ABUSE_REPORT_RETENTION_DAYS=365

## Demo seed

`yarn workspace @app/auth-service seed` (existing) creates 3 users. Extend with room seed in backend:

`yarn workspace @app/backend seed:demo` creates:
- Room #general (public, owner=admin) — welcome message + 5 sample texts
- Room #random (public, owner=admin) — 5 casual messages
- Room #demo (public, owner=admin) — showcases reply, edit, delete, attachment thread

Reviewer walkthrough documented in root README.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-12-01 | Repo public at agreed URL |
| AC-12-02 | Root `docker-compose.yml` runs all services on first up |
| AC-12-03 | `docker compose up` seeds DB if empty |
| AC-12-04 | Healthcheck endpoints respond `{status:"ok"}` |
| AC-12-05 | Default ports documented in README |
| AC-12-06 | `.env.example` present for every service |
| AC-12-07 | docker compose up starts: all 4 services + postgres + redis + mailhog + dozzle |
| AC-12-08 | MailHog SMTP on :1025, web UI on :8025; auth-service SMTP_HOST/SMTP_PORT point to mailhog |
| AC-12-09 | Dozzle on :9999, read-only Docker socket mount; shows logs for all stack services |
| AC-12-10 | Seed script creates #general, #random, #demo rooms with owner=admin user; each seeded with 5–10 sample messages |

## Work items

- Move project root to repo root (currently under `app/`). Option A: keep `app/`, add root `docker-compose.yml` referencing `app/*` build contexts. Option B: flatten to root.
- Add `Dockerfile` (prod) per service (lean, no ts-node in runtime).
- Root compose: seed-on-boot job; healthchecks; volumes for Postgres + attachments.
- README quickstart.

## Containers

| Service | Image | Ports published |
|---|---|---|
| postgres | postgres:16-alpine | — |
| redis | redis:7-alpine | — |
| auth-service | ./src/auth-service (prod Dockerfile) | — |
| backend | ./src/backend | — |
| bff | ./src/bff | 3006 |
| frontend | ./src/frontend (nginx serving built assets) | 3007 |

## Dependencies
EPIC-01..10. EPIC-01 (SMTP consumer), EPIC-14 (SMTP secrets / rate-limits env).

## Risks
MailHog is dev-only; production deploy requires real SMTP — out of MVP scope. Dozzle exposes container logs over :9999; do NOT expose port publicly in production.

## Out of scope
Kubernetes, Helm, CI/CD pipelines.