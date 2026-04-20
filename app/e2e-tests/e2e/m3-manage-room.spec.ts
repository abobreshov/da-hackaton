import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RoomChatPage } from '../pages/room-chat.page';

/**
 * M3 — Manage Room modal full tour (EPIC-05 + EPIC-06 AC-06-03/05/06/09).
 *
 * admin opens /rooms/general, triggers the "Manage room" modal, navigates all
 * five tabs (overview, members, invites, banned, danger), then bans `user`
 * from the Members tab. The user's browser is open on the same room and
 * should be evicted (member row disappears / route redirects). The Banned
 * tab shows the user; Unban re-enables the user as a member.
 */

const USER = { email: 'user@example.com', password: 'User1234!', username: 'user' };
const ADMIN = { email: 'admin@example.com', password: 'Admin123!', username: 'admin' };
const ROOM_ID = 'general';

const WS_DELIVERY_MS = 3_000;

test.describe('M3 — Manage Room: ban + unban round-trip', () => {
  test('admin tours all tabs, bans and unbans user from #general', async ({ browser }) => {
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

      // --- open Manage Room + tour all five tabs.
      await adminChat.openManageRoomModal();

      const tabs = ['overview', 'members', 'invites', 'banned', 'danger'] as const;
      for (const tab of tabs) {
        await adminChat.switchManageRoomTab(tab);
        await expect(adminChat.manageRoomTab(tab)).toHaveAttribute('data-state', 'active');
      }

      // --- ban user from Members tab.
      await adminChat.switchManageRoomTab('members');
      await adminChat.banMemberFromManageRoom(USER.username);

      // --- user is evicted. Either the member row disappears in admin view,
      // or the user's browser is booted from the room route.
      await expect(async () => adminChat.expectMemberNotListed(USER.username)).toPass({
        timeout: WS_DELIVERY_MS,
      });

      // --- Banned tab lists user.
      await adminChat.switchManageRoomTab('banned');
      await adminChat.expectBannedListed(USER.username);

      // --- Unban restores.
      await adminChat.unbanFromManageRoom(USER.username);
      await expect(async () => {
        await expect(
          adminChat.manageRoomModal.locator(
            `[data-testid="manage-room-banned-row"][data-username="${USER.username}"]`,
          ),
        ).toHaveCount(0);
      }).toPass({ timeout: WS_DELIVERY_MS });
    } finally {
      await userCtx.close();
      await adminCtx.close();
    }
  });
});
