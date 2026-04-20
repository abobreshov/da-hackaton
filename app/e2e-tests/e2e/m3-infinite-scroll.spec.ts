import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RoomChatPage } from '../pages/room-chat.page';

/**
 * M3 — infinite scroll backward pagination (EPIC-07 AC-07-09 + AC-07-20).
 *
 * Seeded `#general` has 8+ messages from `seed:demo`. user opens the room,
 * observes the initial page, scrolls to the top of the viewport, and expects
 * an older keyset batch to load (bubble count grows).
 *
 * Precondition: `yarn workspace @app/auth-service seed` must have been run
 * with the demo seed so #general contains enough historical messages to
 * require a second page. If the initial response already returns the full
 * history, the POM helper `expectLoadedOlder` will time out — that is the
 * correct failure mode.
 */

const USER = { email: 'user@example.com', password: 'User1234!', username: 'user' };
const ROOM_ID = 'general';

test.describe('M3 — infinite scroll older messages', () => {
  test('scrolling up on seeded #general loads an older batch', async ({
    loginPage,
    dashboardPage,
    roomChatPage,
  }) => {
    await loginPage.goto();
    await loginPage.login(USER.email, USER.password);
    await dashboardPage.expectLoaded();

    await roomChatPage.goto(ROOM_ID);
    await roomChatPage.expectLoaded();

    // Expect at least the initial page rendered (seed inserts 8+).
    await expect
      .poll(async () => roomChatPage.countMessages(), { timeout: 5_000 })
      .toBeGreaterThanOrEqual(8);

    // Scroll to top + wait for at least one more bubble to appear.
    await roomChatPage.expectLoadedOlder(1);
  });
});
