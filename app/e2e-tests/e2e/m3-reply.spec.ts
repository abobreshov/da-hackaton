import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RoomChatPage } from '../pages/room-chat.page';

/**
 * M3 — reply threading + orphan reply (EPIC-07 AC-07-03 + AC-07-14).
 *
 * admin sends a parent message; user replies; the reply renders with the
 * parent snippet quote. admin then deletes the parent — the reply stays,
 * and its quote flips to "Replying to deleted message" copy.
 */

const USER = { email: 'user@example.com', password: 'User1234!', username: 'user' };
const ADMIN = { email: 'admin@example.com', password: 'Admin123!', username: 'admin' };
// FE route is `/rooms/$roomId` (numeric). Demo seed inserts #general first
// into a clean `rooms` table → bigserial id 1. See backend/scripts/seed-demo.ts.
const ROOM_ID = '1';

const WS_DELIVERY_MS = 3_000;

test.describe('M3 — reply + orphan on parent delete', () => {
  test("user replies to admin's message; parent delete orphans the reply", async ({ browser }) => {
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

      // 1. admin sends parent.
      const parentText = `parent-${Date.now()}`;
      await adminChat.typeAndSend(parentText);
      await expect(userChat.messageByText(parentText).last()).toBeVisible({
        timeout: WS_DELIVERY_MS,
      });

      // 2. user replies to admin's latest.
      const replyText = `reply to parent ${Date.now()}`;
      await userChat.replyToLatestMessage(replyText);
      await userChat.expectMessageVisible(replyText);
      await userChat.expectReplyQuote(parentText);

      // admin also sees the reply + quote.
      await expect(async () => {
        await adminChat.expectMessageVisible(replyText);
        await adminChat.expectReplyQuote(parentText);
      }).toPass({ timeout: WS_DELIVERY_MS });

      // 3. admin deletes the parent. Reply becomes an orphan.
      await adminChat.adminDeleteLatestFrom(ADMIN.username);

      await expect(async () => userChat.expectReplyQuoteDeleted()).toPass({
        timeout: WS_DELIVERY_MS,
      });
      await expect(async () => adminChat.expectReplyQuoteDeleted()).toPass({
        timeout: WS_DELIVERY_MS,
      });
    } finally {
      await userCtx.close();
      await adminCtx.close();
    }
  });
});
