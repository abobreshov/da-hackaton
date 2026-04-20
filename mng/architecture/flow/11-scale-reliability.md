# Flow — EPIC-11 Scale & Reliability

## Horizontal BFF fan-out with Redis adapter

```mermaid
flowchart LR
    C1[Client 1] --> B1[BFF replica 1]
    C2[Client 2] --> B2[BFF replica 2]
    B1 <--> A[Redis Streams / pub-sub<br/>socket.io-redis-adapter]
    B2 <--> A
    B1 --> BE
    B2 --> BE
    BE --> A
```

## Async delete-cascade (account or room)

```mermaid
sequenceDiagram
    participant BE
    participant Q as BullMQ (Redis)
    participant W as Worker
    participant DB
    participant FS
    BE->>Q: enqueue user.cascade.delete {userId}
    Q->>W: dispatch job
    W->>DB: DELETE messages WHERE ...
    W->>DB: SELECT attachment paths
    W->>FS: unlink batch
    W->>DB: DELETE attachments
    W->>Q: ack
    alt job fails (attempt ≤ 5)
        Q->>W: retry exp backoff
    end
    alt attempts > 5
        Q->>Q: move to DLQ cascade-delete.failed
        Q->>W: alert (log + metric)
    end
```

## Load test harness

```mermaid
flowchart TB
    K[k6 / artillery runner] --> S[Scenario config]
    S --> A[300 concurrent WS]
    S --> B[1 room × 1000 members]
    S --> C[10k history scroll]
    A --> REP[metrics: p50/p95 delivery latency]
    B --> REP
    C --> REP
    REP --> DASH[Grafana / stdout summary]
```

## Invariant checks (CI + runtime)

```mermaid
flowchart TD
    REQ[incoming action] --> G1{server-side guard}
    G1 -- fail --> DEN[403/404]
    G1 -- pass --> EX[execute]
    EX --> AUD[audit log insert]
    AUD --> RESP[respond]
```

## Retention pruning (nightly)

```mermaid
sequenceDiagram
    participant CRON as Nightly scheduler
    participant Q as BullMQ
    participant W as Worker
    participant DB as Postgres
    CRON->>Q: enqueue retention.prune {runId}
    Q->>W: dispatch
    W->>DB: DELETE FROM abuse_reports WHERE status <> 'open' AND created_at < NOW() - INTERVAL :ABUSE_REPORT_RETENTION_DAYS
    W->>DB: DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL :AUDIT_LOG_RETENTION_DAYS
    W->>DB: DELETE FROM attachments WHERE created_at < NOW() - INTERVAL :ATTACHMENT_RETENTION_DAYS
    W->>DB: DELETE FROM messages WHERE created_at < NOW() - INTERVAL :MESSAGE_RETENTION_DAYS
    Note over DB: order: reports → audit → attachments → messages<br/>attachments first so messages.reply_to SET NULL chain is safe
    W->>DB: VACUUM (best-effort)
    W->>Q: ack metrics {rowsDeleted}
    alt attempts > 5
        Q->>Q: DLQ retention.prune.failed
    end
```
