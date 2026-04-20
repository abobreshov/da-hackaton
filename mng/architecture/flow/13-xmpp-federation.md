# Flow — EPIC-13 Jabber/XMPP Federation

> **DEFERRED POST-MVP.** EPIC-13 is not in the MVP cut. Diagrams below are architectural direction only; no wiring lands pre-launch. See spec 13-xmpp-federation.md for scope.

## Deployment topology (2 federated servers)

```mermaid
flowchart LR
    subgraph A[Server A — alpha.local]
        FE_A[frontend-a]
        BF_A[bff-a]
        BE_A[backend-a]
        EJ_A[ejabberd-a :5269 s2s]
        PG_A[(postgres-a)]
    end
    subgraph B[Server B — beta.local]
        FE_B[frontend-b]
        BF_B[bff-b]
        BE_B[backend-b]
        EJ_B[ejabberd-b :5269 s2s]
        PG_B[(postgres-b)]
    end
    FE_A --> BF_A --> BE_A --> EJ_A
    FE_B --> BF_B --> BE_B --> EJ_B
    EJ_A <-->|XMPP s2s| EJ_B
```

## XMPP client connection (external Jabber client)

```mermaid
sequenceDiagram
    participant CLI as Jabber Client
    participant EJ as ejabberd-a
    participant AU as auth-service-a
    CLI->>EJ: XMPP TCP 5222 connect
    CLI->>EJ: SASL PLAIN (jid, password)
    EJ->>AU: custom auth hook (HTTP or SQL)
    AU-->>EJ: ok | reject
    EJ-->>CLI: auth success + resource binding
    CLI->>EJ: <presence/>
```

## Cross-server message (A → B)

```mermaid
sequenceDiagram
    participant A as alice@alpha.local
    participant EJA as ejabberd-a
    participant EJB as ejabberd-b
    participant B as bob@beta.local
    A->>EJA: <message to=bob@beta.local/> body
    EJA->>EJB: s2s <message/> over port 5269
    EJB->>B: deliver <message/>
    B-->>EJB: <message/> reply
    EJB->>EJA: s2s deliver
    EJA->>A: reply
```

## Bridge from our WebSocket users to XMPP MUC

```mermaid
sequenceDiagram
    participant WS as Browser WS user alice
    participant BFF
    participant BE
    participant EJ as ejabberd
    WS->>BFF: message.send {roomId=engineering, body}
    BFF->>BE: messages.create
    BE->>BE: persist + publish room:engineering
    BE->>EJ: bridge stanza <message to=engineering@conference.alpha.local/>
    EJ->>EJ: MUC broadcast to XMPP members
```

## Admin dashboards

```mermaid
flowchart LR
    ADMIN --> UI[/admin/connections]
    UI --> BFF_R[GET /admin/xmpp/connections]
    BFF_R --> BE
    BE --> EJ_API[ejabberd REST / mod_admin_extra]
    EJ_API --> LIST[active JIDs]
    ADMIN --> UI2[/admin/federation]
    UI2 --> STATS[/admin/xmpp/federation]
    STATS --> EJ_API
    EJ_API --> FSTAT[bytes/s per s2s link]
```

## Load test

```mermaid
sequenceDiagram
    participant R as Load runner
    participant CA[50 clients on A]
    participant CB[50 clients on B]
    R->>CA: connect + login
    R->>CB: connect + login
    loop test window
        CA->>CB: send message A→B
        CB-->>CA: ack
        CB->>CA: send message B→A
    end
    R->>R: measure p95 delivery, error rate
```
