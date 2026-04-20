# EPIC-10 — UI Shell & Layout

**Req refs:** §4.1–4.5, Appendix A wireframes

## Goal
Classic web chat shell. Top menu, right sidebar (rooms + contacts), main chat in center, composer at bottom, members pane on right.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-10-01 | Top menu: Logo, Public Rooms, Private Rooms, Contacts, Sessions, Profile, Sign out |
| AC-10-02 | Right sidebar collapses to accordion after entering a room |
| AC-10-03 | Rooms + contacts list in sidebar; online dots on contacts |
| AC-10-04 | Members pane on right of chat; shows status |
| AC-10-05 | Autoscroll to latest when user is already at bottom |
| AC-10-06 | No forced autoscroll when user scrolled up |
| AC-10-07 | Infinite scroll backward loads older messages |
| AC-10-08 | Composer: multiline, emoji picker, attach, reply chip (cancellable) |
| AC-10-09 | Unread indicator near room/contact names |
| AC-10-10 | Admin actions via top menu + modal dialogs (Manage Room, Ban/Unban, Manage admins, View bans, Delete room) |

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
Track `stickToBottom` boolean. When near bottom (<100px) → keep sticky; on scroll up → disable; on send → snap back if was sticky.

## Dependencies
Parallel with EPIC-05/06/07.

## Out of scope
Themes, mobile-first responsive. Desktop classic layout only.
