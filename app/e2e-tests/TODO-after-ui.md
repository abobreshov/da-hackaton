# E2E tests to add once UI ships

These journey-level Playwright specs are deferred because the corresponding
UI is not yet implemented in `app/src/frontend/src/routes/`. As of this file,
the only routes that exist are `/login` and `/_auth/dashboard`. Add the specs
below when the referenced EPIC lands.

## EPIC-01 — Accounts & Auth (registration, password reset, TOTP enrollment)

Spec: `mng/specs/01-accounts-auth.md`. No `/register`, `/forgot-password`,
`/reset-password`, or `/account/security` routes exist today.

- [ ] `register.spec.ts` — happy-path user registration
  - fill registration form (email, name, password, confirm password)
  - submit, assert redirect to `/login` (or auto-login to `/dashboard`, TBD)
  - assert seed-collision / duplicate-email error path
  - assert client-side validation (password strength, email format, mismatched confirm)
- [ ] `forgot-password.spec.ts` — request reset link
  - submit email, assert confirmation screen (do NOT assert email delivery)
  - assert 200 regardless of whether email exists (no user-enumeration)
- [ ] `reset-password.spec.ts` — consume reset token
  - navigate with valid token, set new password, assert redirect to `/login`
  - assert invalid/expired token error path
- [ ] `enable-totp.spec.ts` — TOTP enrollment flow on the account page
  - render QR + manual secret, enter generated code, assert enabled state
  - on next login, `two-factor-login.spec.ts` happy-path can be expanded to
    actually submit a TOTP (use `otpauth`/`speakeasy` in-test, or a backdoor
    seed value)
- [ ] `disable-totp.spec.ts` — TOTP removal requires current password + TOTP

## EPIC-05 — Rooms (channels list, room view, membership)

Spec: `mng/specs/05-rooms.md`. No `/rooms`, `/rooms/:id`, or room-creation UI.

- [ ] `rooms-list.spec.ts` — logged-in user sees room list / sidebar
  - assert at least one seeded room is visible
  - assert empty-state copy when user has no memberships
- [ ] `create-room.spec.ts` — create a new room
  - click "new room", fill form (name, visibility), submit
  - assert redirect into the newly created room view
  - assert it appears in the sidebar list
- [ ] `join-leave-room.spec.ts` — membership transitions
  - join a public room from the directory, assert membership pill
  - leave a room, assert it disappears from sidebar

## EPIC-07 — Messaging (room messages, DMs, history)

Spec: `mng/specs/07-messaging.md`. No message composer or message list UI yet.

- [ ] `send-room-message.spec.ts` — compose and post a message
  - type, press Enter, assert message renders optimistically
  - assert it persists after reload
- [ ] `message-history.spec.ts` — paginated scrollback
  - scroll up, assert older messages load, no duplicates
- [ ] `dm-conversation.spec.ts` — direct-message journey
  - start DM with another user, exchange a message, assert both sides see it
  - (requires a second authenticated context — pattern: two `browser.newContext()`)
- [ ] `edit-delete-message.spec.ts` — edit own message, delete own message
  - assert edited indicator, assert deletion tombstone / removal

## EPIC-08 — Attachments (upload, preview, download)

Spec: `mng/specs/08-attachments.md`. No upload button / attachment chip UI.

- [ ] `attach-image.spec.ts` — paperclip → select file → send
  - use `page.setInputFiles()` against a fixture image in `e2e-tests/fixtures/`
  - assert thumbnail renders in the message
  - assert download link returns the same bytes (content-length / sha256)
- [ ] `attach-large-file-rejected.spec.ts` — over-limit file shows error
- [ ] `attach-wrong-mime-rejected.spec.ts` — blocked MIME shows error

## EPIC-06 — Moderation UI (admin dashboard, room-admin actions)

Spec: `mng/specs/06-moderation.md`. No `/admin/*` or in-room moderation UI.

- [ ] `admin-login.spec.ts` — admin logs in via the (currently hidden) admin flow
  - NOTE: `login.tsx` intentionally omits the admin branch today; this spec
    is only meaningful once an admin UI / role toggle ships.
- [ ] `admin-suspend-user.spec.ts` — admin suspends a user
  - suspended user's next login attempt shows blocked-state error
- [ ] `room-admin-kick.spec.ts` — room owner kicks a member
- [ ] `room-admin-mute.spec.ts` — room owner mutes a member
  - muted member cannot send in that room (send button disabled or error)
- [ ] `report-message.spec.ts` — user reports a message, admin sees the report

## EPIC-10 — UI Shell (navigation, responsive layout)

Spec: `mng/specs/10-ui-shell.md`. Only a minimal nav bar exists in `_auth.tsx`.

- [ ] `navigation.spec.ts` — primary nav links route correctly
- [ ] `responsive-layout.spec.ts` — viewport sizes (desktop / tablet / mobile)
  - sidebar collapses, composer remains usable

## Cross-cutting once any of the above ships

- [ ] Session refresh slow-path — expire the session cookie (clear via
  `context.addCookies` with a past `expires`) while refresh cookie remains,
  then navigate to a protected route, assert it renders and a fresh
  `session` cookie is re-issued by the BFF.
- [ ] Accessibility smoke — run `@axe-core/playwright` on each major route.
- [ ] WebSocket presence — assert connection + presence indicator once
  EPIC-02 UI elements land.
