# EPIC-12 — Deployment

**Req refs:** §7

## Goal
Public GitHub repo; `docker compose up` in root folder builds and runs whole app.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-12-01 | Repo public at agreed URL |
| AC-12-02 | Root `docker-compose.yml` runs all services on first up |
| AC-12-03 | `docker compose up` seeds DB if empty |
| AC-12-04 | Healthcheck endpoints respond `{status:"ok"}` |
| AC-12-05 | Default ports documented in README |
| AC-12-06 | `.env.example` present for every service |

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
EPIC-01..10.

## Out of scope
Kubernetes, Helm, CI/CD pipelines.