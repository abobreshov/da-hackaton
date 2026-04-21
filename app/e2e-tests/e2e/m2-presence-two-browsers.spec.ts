import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RoomDetailPage } from '../pages/room-detail.page';

/**
 * M2 demo journey — presence propagation across two browsers (EPIC-02).
 *
 * Two fully-isolated browser contexts simulate two simultaneous users:
 *  - `userCtx`   → signs in as seeded `user@example.com` (username `user`)
 *  - `adminCtx`  → signs in as seeded `admin@example.com` (username `admin`)
 *
 * Both navigate to `/rooms/general` and watch each other's presence dot
 * change state. Acceptance criteria exercised:
 *  - AC-02-03 (active tab → online)
 *  - AC-02-02 (no interaction > AFK_THRESHOLD_SECONDS → afk)
 *  - AC-02-04 / AC-02-10 (context closed → offline ≤2s)
 *  - AC-02-08 (propagation ≤2s)
 *
 * IMPORTANT — AFK threshold: spec default is 60s (see EPIC-02 AC-02-02 and
 * the env var `AFK_THRESHOLD_SECONDS`). That is far too slow for an
 * interactive demo or Playwright's default 30s per-test budget. Local test
 * runs MUST override by exporting `AFK_THRESHOLD_SECONDS=5` on the backend
 * service before booting the stack (or set it inline in
 * `docker-compose.dev.yml` under `backend.environment`). See
 * `mng/specs/02-sessions-presence.md` for rationale.
 */

const USER = { email: 'user@example.com', password: 'User1234!', username: 'user' };
const ADMIN = { email: 'admin@example.com', password: 'Admin123!', username: 'admin' };
// Rooms are addressed by numeric primary key, not slug. The seed inserts
// general=1, random=2, demo=3 in that order — see
// `app/src/backend/scripts/seed-demo.ts`.
const ROOM_ID = '1';

// Allow a generous envelope for the AFK branch — 15s covers a 5s threshold
// plus the 10s scheduler tick from EPIC-02 §Logic step 5.
const AFK_WAIT_MS = 15_000;
// AC-02-08 propagation SLA. Give it a little slack (2s + 1s network jitter).
const PRESENCE_PROPAGATION_MS = 3_000;

test.describe('M2 — presence across two browsers (#general)', () => {
  test('admin observes user transitioning online → afk → offline', async ({ browser }) => {
    // --- Arrange: two isolated browser contexts, each with its own cookies.
    const userCtx = await browser.newContext();
    const adminCtx = await browser.newContext();

    try {
      const userPage = await userCtx.newPage();
      const adminPage = await adminCtx.newPage();

      const userLogin = new LoginPage(userPage);
      const userDash = new DashboardPage(userPage);
      const userRoom = new RoomDetailPage(userPage);

      const adminLogin = new LoginPage(adminPage);
      const adminDash = new DashboardPage(adminPage);
      const adminRoom = new RoomDetailPage(adminPage);

      // --- Act: both users sign in, then both join #general.
      await userLogin.goto();
      await userLogin.login(USER.email, USER.password);
      await userDash.expectLoaded();

      await adminLogin.goto();
      await adminLogin.login(ADMIN.email, ADMIN.password);
      await adminDash.expectLoaded();

      await userRoom.goto(ROOM_ID);
      await userRoom.expectLoaded();
      await adminRoom.goto(ROOM_ID);
      await adminRoom.expectLoaded();

      // Admin should now see the user in the member list.
      await adminRoom.expectMemberListed(USER.username);

      // --- Assert 1: online propagation within the SLA.
      // PresenceDot encodes its state via aria-label only (component has no
      // data-state attribute today — see `components/presence-dot.tsx`).
      await expect(adminRoom.getPresenceDotFor(USER.username)).toHaveAttribute(
        'aria-label',
        /online/i,
        { timeout: PRESENCE_PROPAGATION_MS },
      );

      // --- Act 2: user blurs the tab + idles past the AFK threshold.
      // Blur stops presence pings per EPIC-02 §Logic step 3.
      await userPage.evaluate(() => window.dispatchEvent(new Event('blur')));
      await userPage.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // --- Assert 2: admin sees AFK within the accelerated window.
      await expect(adminRoom.getPresenceDotFor(USER.username)).toHaveAttribute(
        'aria-label',
        /away|afk/i,
        { timeout: AFK_WAIT_MS },
      );

      // --- Act 3: user closes their entire context (all tabs gone).
      await userCtx.close();

      // --- Assert 3: admin sees offline within the propagation SLA
      // (AC-02-10 — last session gone → offline eager publish).
      await expect(adminRoom.getPresenceDotFor(USER.username)).toHaveAttribute(
        'aria-label',
        /offline/i,
        { timeout: PRESENCE_PROPAGATION_MS },
      );
    } finally {
      // userCtx may already be closed above; guard with try/catch.
      await userCtx.close().catch(() => undefined);
      await adminCtx.close();
    }
  });
});
