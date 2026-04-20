# mng/ — Project Design Assets

Planning artefacts for the online chat server. Sourced from `2026_04_18_AI_herders_jam_-_requirements_v3 1.pdf`.

## Layout

```
mng/
├── README.md                         # this file
├── architecture/
│   ├── architecture.md               # system architecture (mermaid)
│   └── flow/                         # per-epic flow charts (flat)
│       ├── 01-accounts-auth.md
│       ├── 02-sessions-presence.md
│       ├── 03-realtime-transport.md
│       ├── 04-contacts-friends.md
│       ├── 05-rooms.md
│       ├── 06-moderation.md
│       ├── 07-messaging.md
│       ├── 08-attachments.md
│       ├── 09-notifications-unread.md
│       ├── 10-ui-shell.md
│       ├── 11-scale-reliability.md
│       ├── 12-deployment.md
│       └── 13-xmpp-federation.md
└── specs/                            # per-epic specs (flat)
    ├── 01-accounts-auth.md
    ├── 02-sessions-presence.md
    ├── 03-realtime-transport.md
    ├── 04-contacts-friends.md
    ├── 05-rooms.md
    ├── 06-moderation.md
    ├── 07-messaging.md
    ├── 08-attachments.md
    ├── 09-notifications-unread.md
    ├── 10-ui-shell.md
    ├── 11-scale-reliability.md
    ├── 12-deployment.md
    ├── 13-xmpp-federation.md
    └── 14-security-nfrs.md
```

## Epics

| # | Epic | Depends |
|---|---|---|
| 01 | Accounts & Authentication | — |
| 02 | Sessions & Presence | 01 |
| 03 | Real-time Transport (WebSocket) | 01, 02 |
| 04 | Contacts / Friends / User Bans | 01 |
| 05 | Chat Rooms (CRUD + Membership) | 01 |
| 06 | Room Moderation (Admins, Bans) | 05 |
| 07 | Messaging Core | 03, 04, 05 |
| 08 | Attachments | 05, 07 |
| 09 | Notifications & Unread | 02, 07 |
| 10 | UI Shell & Layout | parallel |
| 11 | Scale, Performance, Reliability | 01..09 |
| 12 | Deployment | 01..10 |
| 13 | Jabber/XMPP Federation (advanced) | 07, 10, 12 |
| 14 | Security NFRs & Abuse Prevention | 01..10 |

## Specs Index

- EPIC-01 — Accounts & Authentication — `specs/01-accounts-auth.md`
- EPIC-02 — Sessions & Presence — `specs/02-sessions-presence.md`
- EPIC-03 — Real-time Transport — `specs/03-realtime-transport.md`
- EPIC-04 — Contacts, Friends, User Bans — `specs/04-contacts-friends.md`
- EPIC-05 — Rooms — `specs/05-rooms.md`
- EPIC-06 — Room Moderation — `specs/06-moderation.md`
- EPIC-07 — Messaging Core — `specs/07-messaging.md`
- EPIC-08 — Attachments — `specs/08-attachments.md`
- EPIC-09 — Notifications & Unread — `specs/09-notifications-unread.md`
- EPIC-10 — UI Shell — `specs/10-ui-shell.md`
- EPIC-11 — Scale & Reliability — `specs/11-scale-reliability.md`
- EPIC-12 — Deployment — `specs/12-deployment.md`
- EPIC-13 — XMPP Federation — `specs/13-xmpp-federation.md` — **DEFERRED POST-MVP**
- EPIC-14 — Security NFRs & Abuse Prevention — `specs/14-security-nfrs.md`

## Architecture

- System architecture: `architecture/architecture.md`
- Per-epic flow charts: `architecture/flow/*.md`
- See `ADR-001` below for presence ownership across EPIC-02 / EPIC-03 / EPIC-09.

## ADRs

- ADR-001 — Presence source of truth (EPIC-02 owns state; EPIC-03 provides PresencePublisher primitive; EPIC-09 observer only). See EPIC-02 spec + EPIC-03 spec.

## Demo seed

For reviewer walkthrough the stack seeds:

Users (via `yarn workspace @app/auth-service seed`):
- admin@example.com / Admin123! — admin
- user@example.com / User1234! — user
- user2fa@example.com / Secure2FA! — user with TOTP

Demo rooms (via `yarn workspace @app/backend seed:demo` — see EPIC-12):
- #general — welcome + sample conversation
- #random — casual messages
- #demo — showcases reply / edit / delete / attachment

Log stream: Dozzle at http://localhost:9999 (EPIC-12).
Dev SMTP capture: MailHog at http://localhost:8025 (EPIC-12).

## Usage

- Feed `specs/*.md` to implementation agents as the contract.
- Flow charts in `architecture/flow/*.md` render in GitHub/Mermaid Live.
- After authoring, run `/ov-ingest mng/` to make them semantically searchable.
