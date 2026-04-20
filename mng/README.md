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
    └── 13-xmpp-federation.md
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

## Usage

- Feed `specs/*.md` to implementation agents as the contract.
- Flow charts in `architecture/flow/*.md` render in GitHub/Mermaid Live.
- After authoring, run `/ov-ingest mng/` to make them semantically searchable.
