# EPIC-01 — Accounts & Authentication

**Req refs:** §2.1.1–2.1.5, §3.5, §5

## Goal
Self-registration, login, password mgmt, account deletion w/ cascade. Persistent login across browser restart.

## Scope
- Register (email + username + password)
- Uniqueness: email unique, username unique, username immutable
- No email verification
- Sign in / sign out (current browser session only)
- Password reset
- Password change (logged in)
- Passwords hashed (bcrypt ≥12 rounds; already in code)
- Account deletion: remove account; delete owned rooms + their messages/files; remove membership elsewhere

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-01-01 | Register requires email, username, password (all required) |
| AC-01-02 | Duplicate email or username → 409 |
| AC-01-03 | Username immutable after registration |
| AC-01-04 | Login returns refresh cookie + JWT session cookie |
| AC-01-05 | Logout invalidates only current browser refresh token |
| AC-01-06 | Browser close + reopen retains session |
| AC-01-07 | Password reset sends token (out-of-band or direct new-password flow per impl choice); successful reset invalidates all existing sessions |
| AC-01-08 | Password change requires current password |
| AC-01-09 | Delete account: owned rooms (and their msgs + files) deleted; membership rows elsewhere removed; account row soft-deleted or hard-deleted |

## Data model (additions)

```sql
-- existing: admins, users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username VARCHAR(64) NOT NULL UNIQUE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE password_resets (
  token_hash      TEXT PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ
);
```

## API (BFF surface)
- `POST /api/v1/auth/register` `{email, username, password}` → `{user}` | 409
- `POST /api/v1/auth/login` (exists, returns `{user}` or `{requires2fa}`)
- `POST /api/v1/auth/logout` (exists)
- `POST /api/v1/auth/password-reset/request` `{email}` → 204
- `POST /api/v1/auth/password-reset/confirm` `{token, newPassword}` → 204
- `POST /api/v1/auth/password-change` `{currentPassword, newPassword}` → 204
- `DELETE /api/v1/account` → 204 (cookie cleared)

## Cross-service contracts
- Auth service TCP cmds: `auth.customer.register`, `auth.customer.passwordReset.request`, `auth.customer.passwordReset.confirm`, `auth.customer.passwordChange`, `auth.customer.delete`
- On account delete Auth emits TCP `users.delete.cascade` to BE for room/msg/file cleanup

## Out of scope
- Email verification
- Social login
- MFA beyond existing TOTP (separate concern)

## Dependencies
None (foundational).

## Risks
- Delete-cascade must be transactional or idempotent across Auth + BE. Use BullMQ job + sagas pattern if eventual consistency OK (see EPIC-11).