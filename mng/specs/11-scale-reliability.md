# EPIC-11 — Scale, Performance, Reliability

**Req refs:** §3.1–3.3, §3.6

## Goal
Hit non-functional targets. Load-test; verify consistency invariants; harden async cleanup. Retention is configurable via env vars (default 30 days). Hosts the async account-deletion cascade consumer (from EPIC-04). No backup/DR in MVP scope.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-11-01 | Server supports 300 simultaneous WebSocket connections |
| AC-11-02 | Single room supports up to 1000 participants without perf degradation |
| AC-11-03 | Sizing baseline: 20 rooms × 50 contacts per user verified |
| AC-11-04 | Message delivery p95 ≤3s under load |
| AC-11-05 | Presence propagation p95 ≤2s |
| AC-11-06 | Rooms with 10k+ messages scroll smoothly (no block >200ms) |
| AC-11-07 | Messages stored persistently (no data loss, years-long retention) |
| AC-11-08 | Consistency invariants hold: membership, room bans, file access, history, admin/owner perms |
| AC-11-09 | Retention env vars: MESSAGE_RETENTION_DAYS (default 30), ATTACHMENT_RETENTION_DAYS (default 30), AUDIT_LOG_RETENTION_DAYS (default 30), ABUSE_REPORT_RETENTION_DAYS (default 90) |
| AC-11-10 | Nightly BullMQ pruning job deletes rows + files older than respective retention window |
| AC-11-11 | Async account-deletion cascade consumer (BullMQ queue `user.cascade.delete`) lives here; processes owned rooms + messages + attachments + friendships + user_bans cleanup |
| AC-11-12 | EPIC-13 (XMPP federation) deferred post-MVP — not required for submission |

## Load test plan (artillery / k6)

- Scenario A: 300 concurrent connect, each joins 20 rooms, sends 1 msg every 30s over 10min
- Scenario B: 1 room with 1000 members; each sends 1 msg/10s for 5min
- Scenario C: scroll 10k-message history from single client: ensure p95 page load ≤300ms

## Reliability mechanisms

- **Async cleanup:** BullMQ jobs for
  - delete-account cascade (rooms owned → messages → attachments → memberships)
  - room-delete cascade
  - attachment FS sweep
- **Invariant enforcement:** server-side guards only, never trust client
- **Idempotent jobs:** retries safe; dedupe via job keys

## Database

- PK + FK cascades as designed
- Partial indexes on `deleted_at IS NULL`
- Consider partitioning `messages` by room_id hash at scale; not needed for 300 users

## Observability

- Pino logs (existing) + request IDs
- WS-gateway metrics: active connections, msg throughput
- Redis adapter metrics: pub/sub rate

## Retention (env-configurable)

| Env var | Default | Applies to |
|---|---|---|
| MESSAGE_RETENTION_DAYS | 30 | messages.created_at |
| ATTACHMENT_RETENTION_DAYS | 30 | attachments.created_at + file on disk |
| AUDIT_LOG_RETENTION_DAYS | 30 | audit_log.created_at |
| ABUSE_REPORT_RETENTION_DAYS | 90 | abuse_reports.created_at (resolved only) |

Pruning job: BullMQ nightly worker (`retention.prune`). Deletes in batches (5000 rows) to avoid long locks. Logs count per table.

## Account-deletion cascade consumer

BullMQ queue `user.cascade.delete` consumer. Steps per job:

1. Delete owned rooms (cascade deletes messages, attachments rows)
2. Delete attachment files on disk (best-effort, log errors)
3. Delete friendship rows referencing user
4. Delete user_bans rows referencing user
5. Delete refresh tokens (Redis)
6. Delete user_sessions rows
7. Finalize: hard-delete users row (previously soft-deleted by EPIC-01)

Idempotent. Retries on failure. Dead-letter after 5 attempts — admin alert via audit_log.

## Dependencies
EPIC-01..09. EPIC-04 (cascade job), EPIC-06 (audit + report retention), EPIC-07 (messages retention), EPIC-08 (attachments retention). EPIC-13 deferred.

## Out of scope
Multi-region replication.