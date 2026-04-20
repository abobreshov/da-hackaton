# EPIC-13 — Jabber/XMPP Federation (Advanced)

**Req refs:** §6

## Goal
Interoperate with XMPP clients; federate two servers in docker-compose; demonstrate A↔B messaging with 50+ clients each.

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
- Separate container per deployment (ejabberd with s2s enabled)
- BE Service bridges app users ↔ XMPP JIDs; app rooms ↔ MUC
- Shared Postgres for user auth (via ejabberd SQL backend) OR custom auth module calling our Auth Service
- Federation s2s on port 5269 between A and B

**Option 2 — Embedded library** (`@xmpp/server` for Node):
- Lighter, runs inside BE
- Less feature-complete; skip if time-limited

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

- 50 clients/server (use `xmpploadtester` or custom script)
- Each client sends N messages/sec to a peer on opposite server
- Measure delivery latency + error rate

## Dependencies
EPIC-07, EPIC-10, EPIC-12.

## Risks
- s2s DNS + TLS requirements; fake certs for local testing
- ejabberd auth integration complexity — may require separate shadow user store
- Scope creep — strictly optional

## Out of scope
Multi-hop federation (>2 servers), discovery via DNS SRV in production setup.
