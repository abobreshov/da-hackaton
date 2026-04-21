import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RoomDetailPage } from '../pages/room-detail.page';
import { RoomsPage } from '../pages/rooms.page';

/**
 * M2 — room join + member-list + leave.
 *
 * Rewritten scope: seeded user opens the rooms catalog, navigates into
 * the first public room, sees the member sidebar render via WS room.join
 * ack, then leaves. The WS auto-provision flow (POST /rooms/:id/join when
 * the gateway rejects with "not a member") is exercised implicitly —
 * this spec doesn't care how the caller became a member, only that the
 * DOM contract is:
 *
 *   1. `<ul aria-label="Members">` visible once the WS ack resolves.
 *   2. The current user's row is listed — we assert the row matching
 *      their rendered username (seeded `users.name = 'Dev User'`).
 *   3. Clicking the `data-testid="room-leave-button"` returns to /rooms.
 *
 * Does not touch presence, delete, moderation, or cross-user fan-out.
 * Admin is not involved so the seeded admin-2FA drift can't interfere.
 */

const USER = { email: 'user@example.com', password: 'User1234!', username: 'Dev User' };

test.describe('M2 — room join / leave', () => {
  test('seeded user opens a public room, sees themselves in Members, leaves back to catalog', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      const login = new LoginPage(page);
      const dashboard = new DashboardPage(page);
      const rooms = new RoomsPage(page);
      const detail = new RoomDetailPage(page);

      await login.goto();
      await login.expectLoaded();
      await login.login(USER.email, USER.password);
      await dashboard.expectLoaded();

      // Pick the first room link from the catalog — seed inserts #general
      // with id 1, but we avoid hard-coding since prior specs may have
      // created/deleted rooms in the same DB session.
      await rooms.goto();
      await rooms.expectLoaded();
      const firstLink = page.locator('a[href^="/rooms/"]').first();
      await expect(firstLink).toBeVisible();
      const href = await firstLink.getAttribute('href');
      expect(href, 'rooms catalog exposes at least one /rooms/:id link').toBeTruthy();
      const match = href!.match(/\/rooms\/(\d+)/);
      expect(match, 'room link has a numeric id segment').not.toBeNull();
      const roomId = match![1];

      await detail.goto(roomId);
      await detail.expectLoaded(); // waits for members <ul> via WS ack

      // Current user is listed. Uses username filter on the member list.
      await expect(
        detail.getMemberList().getByRole('listitem').filter({ hasText: USER.username }).first(),
      ).toBeVisible();

      // Leave flow — route renders a distinct `room-leave-button` testid
      // for non-owners. Click returns the user to /rooms.
      const leaveButton = page.getByTestId('room-leave-button');
      await expect(leaveButton).toBeVisible();
      await leaveButton.click();
      await page.waitForURL(/\/rooms$/);

      // Back on the catalog — heading is visible again (sanity check the
      // navigation actually happened, not just a URL change).
      await rooms.expectLoaded();
    } finally {
      await ctx.close();
    }
  });
});
