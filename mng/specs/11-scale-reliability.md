# EPIC-11 — Scale, Performance, Reliability

**Req refs:** §3.1–3.3, §3.6

## Goal
Hit non-functional targets. Load-test; verify consistency invariants; harden async cleanup.

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

## Dependencies
EPIC-01..09.

## Out of scope
Multi-region replication.