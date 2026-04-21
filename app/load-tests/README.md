# Load tests (k6)

Smoke-scale load scripts so the M5 demo can quote real p95 numbers against the
EPIC-11 envelope (300 concurrent rooms × 1000 members × 6 msg/s). These scripts
do not hit the full envelope — they exercise the same code path at a fraction
of the volume and report latency / error rate.

## Pre-requisites

1. **Stack running.** Either `./app/dev.sh` (full Docker) or
   `./app/dev-local.sh` (Docker infra + host services). BFF must be reachable
   at `http://localhost:3006`.
2. **Seeded.** Default admin / user / user2fa creds exist; demo seed has run
   so room id `1` (`#general`) exists. Run `./seed-load.sh` if unsure.
3. **k6 installed locally.** Not bundled with the repo. Install per
   <https://k6.io/docs/get-started/installation/> (Linux: `sudo apt install k6`
   from the official repo, macOS: `brew install k6`).

Verify:

```bash
k6 version
curl -sf http://localhost:3006/api/v1/health
```

## Seed creds (from `app/CLAUDE.md`)

| email                | password    | notes                |
|----------------------|-------------|----------------------|
| admin@example.com    | Admin123!   | admin, no 2FA        |
| user@example.com     | User1234!   | user, no 2FA — used  |
| user2fa@example.com  | Secure2FA!  | TOTP, skip for k6    |

The `loadtest@example.com` user mentioned in the M5 brief is **not** seeded by
default — see *Scaling to N users* below for how to add it without modifying
`scripts/seed.ts`.

## Run

```bash
# 1. baseline seed (idempotent)
./app/load-tests/seed-load.sh

# 2. message burst (50 VUs, ~130 s wall clock)
k6 run app/load-tests/k6-message-burst.js

# 3. presence/read-path fanout (100 VUs hitting /health)
k6 run app/load-tests/k6-presence-fanout.js

# 4. (optional) run both at once in two terminals to observe contention
```

Override targets via env:

```bash
BASE_URL=http://localhost:3006/api/v1 \
ORIGIN=http://localhost:3007 \
USER_EMAIL=user@example.com USER_PASSWORD=User1234! \
ROOM_ID=1 \
k6 run app/load-tests/k6-message-burst.js
```

## Scenarios

### `k6-message-burst.js`

- **Profile:** ramping-vus — 30 s ramp to 50 VUs, 90 s steady, 10 s ramp-down.
- **Per-VU loop:** login → POST `/api/v1/messages` (roomId=1) every 500 ms.
- **Thresholds (build-fails when violated):**
  - `msg_send_latency_ms p(95) < 500`
  - `msg_send_errors rate < 0.01`
  - `http_req_failed rate < 0.05`
- **Reports:** p95 + avg latency, success counter, error rate. JSON dump at
  `app/load-tests/last-burst-summary.json`.

### `k6-presence-fanout.js`

- **Profile:** 20 s ramp to 100 VUs, 90 s steady, 10 s ramp-down.
- **Per-VU loop:** GET `/api/v1/health` every 200 ms (~5 req/s/VU = ~500 rps).
- **Thresholds:** `health_latency_ms p(95) < 200`.
- **Why HTTP not WS:** k6's `ws` module does not share a cookie jar with
  `http.*`, and the BFF gateway demands a signed session cookie + matching
  Origin on the upgrade. For an M5 smoke we proxy presence load with a cheap
  GET; the property under test is "the read path is not starved by writes".

## Scaling to N distinct users

The auth-service seed script intentionally is not modified by this directory.
Two supported paths to fan out:

1. **Use the same seed user across all VUs (default).** Fine for stress on the
   message-send pipeline; misses per-user cache effects.
2. **Register loadtest users via the public API.**
   `./seed-load.sh --register 50` posts 50 `loadtest+N@example.com`
   registrations. Every registration returns `202` regardless of success and
   email verification is required before login — so this only works when an
   inbox endpoint (Mailpit at <http://localhost:8025>) is polled to extract
   the verify link, or when the backend exposes a bulk-create that bypasses
   verification (not yet shipped).
3. **Recommended next step:** add a `scripts/seed-load-users.ts` workspace
   script that inserts N pre-verified rows directly via Drizzle, gated behind
   `NODE_ENV !== 'production'`. Out of scope for this commit.

## Output artefacts

- `last-burst-summary.json` — full k6 metrics dump after `k6-message-burst.js`.
- `last-presence-summary.json` — same, for the presence script.

Both are gitignored implicitly (under `app/load-tests/`); add them to
`.gitignore` if they start showing up in `git status`.

## Troubleshooting

- **`401 Unauthorized` on /messages** — login probably failed. Re-run
  `./seed-load.sh`; verify creds with `curl … /auth/login`.
- **`403 Origin not allowed`** — set `ORIGIN=http://localhost:3007` (default
  from `ALLOWED_ORIGINS` in BFF env).
- **`EADDRINUSE` / dev stack stuck** — see `./app/dev-doctor.sh` (project
  root `CLAUDE.md`).
- **k6 binary missing** — `k6 version` should print v0.50+; older versions
  don't ship `ramping-vus`.
