import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RoomChatPage } from '../pages/room-chat.page';

/**
 * M3 — author edit + delete (EPIC-07 AC-07-04, AC-07-05, AC-07-18).
 *
 * user sends a message, edits it (edited indicator renders for both), then
 * deletes it (tombstone renders for both). 2nd browser (admin) observes each
 * transition live via the `message.edited` / `message.deleted` WS push.
 */

const USER = { email: 'user@example.com', password: 'User1234!', username: 'user' };
const ADMIN = { email: 'admin@example.com', password: 'Admin123!', username: 'admin' };
const ROOM_ID = 'general';

const WS_DELIVERY_MS = 3_000;

test.describe('M3 — author edit and delete', () => {
  test('user edits then deletes own message; admin sees both', async ({ browser }) => {
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

      const original = `edit-me ${Date.now()}`;
      const edited = `${original} (fixed typo)`;

      // 1. user sends.
      await userChat.typeAndSend(original);
      await expect(adminChat.messageByText(original).last()).toBeVisible({
        timeout: WS_DELIVERY_MS,
      });

      // 2. user edits.
      await userChat.editLatestMessage(edited);
      await userChat.expectEdited(edited);
      await expect(async () => adminChat.expectEdited(edited)).toPass({
        timeout: WS_DELIVERY_MS,
      });

      // 3. user deletes.
      await userChat.deleteLatestMessage();
      await userChat.expectTombstone(edited);
      await expect(async () => adminChat.expectTombstone(edited)).toPass({
        timeout: WS_DELIVERY_MS,
      });
    } finally {
      await userCtx.close();
      await adminCtx.close();
    }
  });
});
