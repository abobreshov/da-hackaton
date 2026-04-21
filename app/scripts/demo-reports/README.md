# demo-reports

Output directory for `app/scripts/demo-verify.sh`.

> Note — the canonical report path is `app/demo-reports/`, not this folder.
> This `scripts/demo-reports/` directory exists only to keep a `.gitkeep` and
> this README near the script. The wrapper writes reports to
> `app/demo-reports/demo-verify-<YYYYMMDD-HHMMSS>.md`.

## Report format

Each run produces one markdown file:

```
demo-verify-20260420-143055.md
```

Sections:

| Section | Contents |
|---|---|
| Header | Timestamp, git commit SHA, dev mode (`dev.sh` or `dev-local.sh`), total runtime, flag values. |
| Pre-flight | Per-check status: docker daemon, port 3006/3007/5433/6380, playwright presence, k6 presence. |
| E2E (Playwright) | Run status, totals (pass/fail/flaky/skipped/specs), per-spec pass count. |
| Load (k6) | Status (`ran`, `skipped`, or `skipped (k6 not installed)`) plus p95 latency for `k6-message-burst` and `k6-presence-fanout`. |
| Verdict | One-line PASS/FAIL/SKIPPED summary per category. |

## How to read

- **Header** — confirms which commit and which dev mode produced the numbers.
- **Pre-flight** — if anything is BUSY, the run aborts before bring-up. Run
  `./dev-doctor.sh --clean` to clear orphans.
- **E2E** — `pass=N fail=M`. Any non-zero `fail` means the demo flow regressed.
  The per-spec list shows which suite owns the failures.
- **Load** — p95 numbers. Compare against the SLO in
  `mng/specs` (latency targets). Missing values mean the corresponding k6
  script wasn't found or k6 isn't installed.
- **Verdict** — the line you scan first. Drill into the sections above for
  the why.

## Local-only

Reports are gitignored (`app/demo-reports/*.md`). Commit the wrapper, never
the output.

## Flags recap

```
./scripts/demo-verify.sh             # full run (Docker stack)
./scripts/demo-verify.sh --local     # use dev-local.sh
./scripts/demo-verify.sh --keep-data # don't down -v on teardown
./scripts/demo-verify.sh --skip-e2e  # skip Playwright
./scripts/demo-verify.sh --skip-load # skip k6
./scripts/demo-verify.sh --help
```
