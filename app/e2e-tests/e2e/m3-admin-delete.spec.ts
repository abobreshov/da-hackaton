import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RoomChatPage } from '../pages/room-chat.page';

/**
 * M3 — admin deletes another author's message (EPIC-07 AC-07-06).
 *
 * User sends a message; admin deletes it via the bubble context menu; both
 * sides see the "This message was deleted" tombstone propagated via WS.
 * Audit-log assertion intentionally out of scope — this spec stays focused
 * on the chat-surface contract.
 */

const USER = { email: 'user@example.com', password: 'User1234!', username: 'Dev User' };
const ADMIN = { email: 'admin@example.com', password: 'Admin123!' };
const ROOM_ID = '1';

const WS_DELIVERY_MS = 3_000;

test.describe('M3 — admin deletes another author', () => {
  test("admin deletes user's message; both sides see 'This message was deleted'", async ({
    browser,
  }) => {
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

      const text = `naughty-text-${Date.now()}`;
      await userChat.typeAndSend(text);
      await expect(adminChat.messageByText(text).last()).toBeVisible({
        timeout: WS_DELIVERY_MS,
      });

      await adminChat.adminDeleteLatestFrom(USER.username);

      await expect(async () => adminChat.expectTombstone(text)).toPass({
        timeout: WS_DELIVERY_MS,
      });
      await expect(async () => userChat.expectTombstone(text)).toPass({
        timeout: WS_DELIVERY_MS,
      });
    } finally {
      await userCtx.close();
      await adminCtx.close();
    }
  });
});
