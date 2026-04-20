import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RoomChatPage } from '../pages/room-chat.page';

/**
 * M3 demo journey — two-browser send/receive (EPIC-07 AC-07-08).
 *
 * Admin + user both sign in, both open `/rooms/general`, admin sends a
 * message; user observes it in their viewport within the 3s propagation SLA.
 */

const USER = { email: 'user@example.com', password: 'User1234!', username: 'user' };
const ADMIN = { email: 'admin@example.com', password: 'Admin123!', username: 'admin' };
const ROOM_ID = 'general';

const WS_DELIVERY_MS = 3_000;

test.describe('M3 — messaging send/receive across two browsers', () => {
  test('admin sends in #general, user sees it within 3s', async ({ browser }) => {
    const userCtx = await browser.newContext();
    const adminCtx = await browser.newContext();

    try {
      const userPage = await userCtx.newPage();
      const adminPage = await adminCtx.newPage();

      const userLogin = new LoginPage(userPage);
      const userDash = new DashboardPage(userPage);
      const userChat = new RoomChatPage(userPage);

      const adminLogin = new LoginPage(adminPage);
      const adminDash = new DashboardPage(adminPage);
      const adminChat = new RoomChatPage(adminPage);

      await userLogin.goto();
      await userLogin.login(USER.email, USER.password);
      await userDash.expectLoaded();

      await adminLogin.goto();
      await adminLogin.login(ADMIN.email, ADMIN.password);
      await adminDash.expectLoaded();

      await userChat.goto(ROOM_ID);
      await userChat.expectLoaded();
      await adminChat.goto(ROOM_ID);
      await adminChat.expectLoaded();

      const text = `hello from admin ${Date.now()}`;
      await adminChat.typeAndSend(text);

      await expect(userChat.messageByText(text).last()).toBeVisible({
        timeout: WS_DELIVERY_MS,
      });
    } finally {
      await userCtx.close();
      await adminCtx.close();
    }
  });
});
