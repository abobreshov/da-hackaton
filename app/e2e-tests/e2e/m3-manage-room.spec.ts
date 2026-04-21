import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RoomChatPage } from '../pages/room-chat.page';

/**
 * M3 — Manage Room modal full tour (EPIC-05 + EPIC-06 AC-06-03/05/06/09).
 *
 * admin opens seeded #general (`/rooms/1`), triggers the "Manage room" modal, navigates all
 * five tabs (overview, members, invites, banned, danger), then bans `user`
 * from the Members tab. The user's browser is open on the same room and
 * should be evicted (member row disappears / route redirects). The Banned
 * tab shows the user; Unban re-enables the user as a member.
 */

const USER = { email: 'user@example.com', password: 'User1234!', username: 'user' };
const ADMIN = { email: 'admin@example.com', password: 'Admin123!', username: 'admin' };
// FE route is `/rooms/$roomId` (numeric). Demo seed inserts #general first
// into a clean `rooms` table → bigserial id 1. See backend/scripts/seed-demo.ts.
const ROOM_ID = '1';

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

      const tabs = ['members', 'admins', 'banned', 'invitations', 'settings'] as const;
      for (const tab of tabs) {
        await adminChat.switchManageRoomTab(tab);
        // Tab buttons reflect their active state via `aria-pressed` (see
        // `manage-room-modal.tsx`); they do NOT use Radix's data-state attr.
        await expect(adminChat.manageRoomTab(tab)).toHaveAttribute('aria-pressed', 'true');
      }

      // --- ban user from Members tab. We need the target's numeric id, which
      // the FE wires into the per-row testid (`member-action-ban-{id}`). The
      // /api/v1/auth/session endpoint exposes the OIDC sub from which we can
      // recover the numeric id for the user we want to ban.
      await adminChat.switchManageRoomTab('members');
      const userSession = await userPage.request.get('/api/v1/auth/session');
      expect(userSession.ok()).toBe(true);
      const userBody = await userSession.json();
      const userIdMatch = String(userBody.sub ?? '').match(/^u:(\d+)$/);
      expect(userIdMatch, `unexpected user sub: ${userBody.sub}`).not.toBeNull();
      const userId = Number(userIdMatch![1]);
      await adminChat.banMemberById(userId);

      // --- user is evicted. The member row disappears from admin's sidebar
      // member list once the broadcast lands.
      await expect(async () => adminChat.expectMemberNotListed(USER.username)).toPass({
        timeout: WS_DELIVERY_MS,
      });

      // --- Banned tab lists user.
      await adminChat.switchManageRoomTab('banned');
      await adminChat.expectBannedListed(USER.username);

      // --- Unban restores.
      await adminChat.unbanById(userId);
      await expect(async () => {
        const bannedList = adminChat.manageRoomModal.getByRole('list', { name: /banned users/i });
        await expect(bannedList.getByRole('listitem').filter({ hasText: USER.username })).toHaveCount(
          0,
        );
      }).toPass({ timeout: WS_DELIVERY_MS });
    } finally {
      await userCtx.close();
      await adminCtx.close();
    }
  });
});
