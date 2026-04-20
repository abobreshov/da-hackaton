# EPIC-10 — UI Shell & Layout

**Req refs:** §4.1–4.5, Appendix A wireframes

## Goal
Classic web chat shell. Top menu, right sidebar (rooms + contacts), main chat center, composer bottom, members pane right.

## Scope
- Web-only layout (desktop breakpoints). Mobile layout POST-MVP stretch if time permits.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-10-01 | Top menu: Logo, Public Rooms, Private Rooms, Contacts, Sessions, Profile, Sign out |
| AC-10-02 | Right sidebar collapse to accordion after entering room |
| AC-10-03 | Rooms + contacts list in sidebar; online dots on contacts |
| AC-10-04 | Members pane right of chat; show status |
| AC-10-05 | Autoscroll to latest when user already at bottom |
| AC-10-06 | No forced autoscroll when user scrolled up |
| AC-10-07 | Infinite scroll backward load older messages |
| AC-10-08 | Composer: multiline, emoji picker, attach, reply chip (cancellable) |
| AC-10-09 | Unread indicator near room/contact names |
| AC-10-10 | Admin actions via top menu + modal dialogs (Manage Room, Ban/Unban, Manage admins, View bans, Delete room) |
| AC-10-11 | Layout targets desktop viewports ≥1024px. Responsive shrink below is best-effort; mobile breakpoints POST-MVP |
| AC-10-12 | Admin panel MVP surface: only the in-room Manage Room modal (§4.5). Reports queue + audit-log viewer = REST-only; dedicated UI post-MVP. |

## Routes (TanStack)
```
/login
/forgot-password
/_auth
  /                 → redirect to last room or /rooms/catalog
  /rooms/catalog
  /rooms/:id        → room view
  /dms/:userId      → DM view
  /contacts
  /sessions
  /profile
```

## Components

| Component | Role |
|---|---|
| `AppShell` | Top bar + sidebar + outlet |
| `RoomsSidebar` | Public/Private accordion groups, create-room CTA |
| `ContactsSidebar` | Friends list with presence |
| `ChatView` | Header, message list, composer, members pane |
| `MessageList` | Virtualized backward scroll, reply quote |
| `Composer` | Multiline input, emoji, attach, reply chip |
| `ManageRoomModal` | Tabs: Members / Admins / Banned / Invitations / Settings |
| `UserPopover` | Friend request, block, open DM |

## Scroll rules
Track `stickToBottom` boolean. Near bottom (<100px) → keep sticky; scroll up → disable; on send → snap back if was sticky.

## Dependencies
Parallel with EPIC-05/06/07.

## Out of scope
Themes, mobile-first responsive. Desktop classic layout only.
- Mobile-specific layouts / touch gestures / PWA (post-MVP stretch)
- Dark mode / theming
- Admin UI for audit_log + abuse_reports queue (MVP uses REST endpoints + Dozzle / devtools; dedicated panel POST-MVP stretch)