# EPIC-13 — Jabber/XMPP Federation (Advanced)

> **Status: DEFERRED POST-MVP.** Per product decision 2026-04-20, EPIC-13 is not in the MVP deliverable. Full scope retained below for future work. Load-test thresholds + numeric SLAs to be added before implementation kick-off.

**Req refs:** §6

## Goal
(Post-MVP.) Interop XMPP clients. Federate two servers in docker-compose. Demo A↔B messaging, 50+ clients each.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-13-01 | Jabber client can connect to our server using XMPP |
| AC-13-02 | Two deployments (Server A + Server B) federate via s2s |
| AC-13-03 | Messages can flow A→B and B→A |
| AC-13-04 | Admin UI has connection dashboard |
| AC-13-05 | Admin UI shows federation traffic stats |
| AC-13-06 | Load test: 50+ clients/server, messages A↔B succeed |

## Architecture options

**Option 1 — Sidecar ejabberd/prosody** (recommended):
- Separate container per deployment (ejabberd, s2s enabled)
- BE Service bridge app users ↔ XMPP JIDs; app rooms ↔ MUC
- Shared Postgres for user auth (ejabberd SQL backend) OR custom auth module calling Auth Service
- Federation s2s port 5269 between A and B

**Option 2 — Embedded library** (`@xmpp/server` for Node):
- Lighter, runs inside BE
- Less feature-complete. Skip if time-limited

## Docker-compose federation setup

```
A (alpha.local)
  postgres-a, redis-a, auth-a, backend-a, bff-a, frontend-a, ejabberd-a

B (beta.local)
  postgres-b, redis-b, auth-b, backend-b, bff-b, frontend-b, ejabberd-b

network: shared overlay; ejabberd-a:5269 ↔ ejabberd-b:5269
DNS: fake hosts via docker-compose aliases
```

## Bridge mapping

| App concept | XMPP concept |
|---|---|
| user `alice` | JID `alice@alpha.local` |
| room `#engineering` | MUC `engineering@conference.alpha.local` |
| message | `<message>` stanza |
| presence | `<presence>` stanza (basic online/offline; AFK maps to `away`) |

## Admin UI additions (EPIC-10)

- `/admin/connections` — XMPP sessions table (JID, resource, connected_at, IP)
- `/admin/federation` — s2s links, bytes in/out, pending stanzas

## Load test

- 50 clients/server (`xmpploadtester` or custom script)
- Each client sends N messages/sec to peer on opposite server
- Measure delivery latency + error rate

## Dependencies
EPIC-07, EPIC-10, EPIC-12. EPIC-14 (security baseline for federated traffic). Kick-off blocked by MVP merge + load-test threshold definition.

## Risks
- s2s DNS + TLS requirements. Fake certs for local testing
- ejabberd auth integration complex. May need separate shadow user store
- Scope creep. Strictly optional
- Scope risk: §6 load test requires 50+ clients × 2 servers; no numeric latency/error thresholds yet — must be defined before starting.

## Out of scope
Multi-hop federation (>2 servers). Discovery via DNS SRV in production setup.