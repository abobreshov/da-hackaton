# app/scripts

Operational scripts for the hackathone monorepo. Run from `app/`.

## `gen-certs.sh`

Mints a throwaway internal CA + per-service mTLS leaf certs into
`app/secrets/internal-ca/` (gitignored, 1-year validity). Required before any
inter-service TCP call when `TLS_ENABLED=true`. Run once per checkout, or with
`--force` to rotate. See `app/CLAUDE.md` § "Inter-service security".

## `smoke.sh`

Reviewer-ready test gauntlet — one command runs the full pre-merge / pre-demo
verification. Use it before opening a PR, before tagging a release, and any
time you want a single green/red signal that the monorepo still builds and
the unit suites still pass.

What it does, in order:

1. **Build** every published workspace (`@app/contracts`, `@app/auth-service`,
   `@app/backend`, `@app/bff`, `@app/frontend`).
2. **Test** the same workspaces — Jest for the four NestJS services + the
   contracts package, Vitest for the React frontend.
3. **Typecheck** the Playwright suite (`e2e-tests/`) via `tsc --noEmit`. The
   E2E specs are not executed (they need a running stack); typecheck alone is
   enough to catch import drift after refactors.
4. Print a coloured summary table with per-workspace test counts (extracted
   from Jest / Vitest stdout) and total wall-clock time.

Each step's stdout + stderr is captured to `/tmp/smoke-<workspace>-<step>.log`.
On failure the script tails the last 20 lines of the offending log to stderr,
points at the full file, and exits non-zero immediately — no further steps run.

### Usage

```bash
./scripts/smoke.sh                     # full gauntlet
./scripts/smoke.sh --skip-build        # tests only (after a prior build)
./scripts/smoke.sh --skip-tests        # builds + e2e typecheck only
./scripts/smoke.sh --workspace=@app/bff   # narrow to one workspace
./scripts/smoke.sh --help
```

Colour output is auto-disabled when stdout is not a TTY (CI logs, `tee` to a
file, piping through `cat`) — the script detects `[ -t 1 ]` and emits plain
ASCII status markers (`OK` / `FAIL` / `-`) in that case.

Exit codes: `0` = everything green, `1` = a step failed, `2` = bad CLI flag.

### When NOT to use it

- For runtime / integration smoke against a running stack, boot the stack with
  `./dev.sh` and exercise it manually or via `e2e-tests/`. `smoke.sh` is a
  **static** gauntlet — it does not start Docker, Postgres, Redis, or any of
  the four NestJS services.
- For a single workspace iteration loop, just run
  `yarn workspace @app/<name> test --watch` — `smoke.sh` is whole-repo,
  cold-start.
