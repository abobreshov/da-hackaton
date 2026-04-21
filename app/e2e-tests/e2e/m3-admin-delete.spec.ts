import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RoomChatPage } from '../pages/room-chat.page';
import { AdminPage } from '../pages/admin.page';

/**
 * M3 — admin deletes another author's message (EPIC-07 AC-07-06 + EPIC-06
 * AC-06-12 audit).
 *
 * user sends a message; admin deletes it via the bubble context menu; both
 * see the tombstone. Admin then visits `/admin/audit-log` and finds a
 * `message.delete` entry recorded under their username.
 */

// Note: usernames here match `users.name` (what FE renders + what the BFF
// stamps onto each message as `author.username`). The seeded users have
// display names "Dev User" / "Dev Admin" — the earlier literal "user" /
// "admin" values predated the auth-service seed rename.
const USER = { email: 'user@example.com', password: 'User1234!', username: 'Dev User' };
const ADMIN = { email: 'admin@example.com', password: 'Admin123!', username: 'Dev Admin' };
// FE route is `/rooms/$roomId` (numeric). Demo seed inserts #general first
// into a clean `rooms` table → bigserial id 1. See backend/scripts/seed-demo.ts.
const ROOM_ID = '1';

const WS_DELIVERY_MS = 3_000;

test.describe('M3 — admin deletes another author', () => {
  test("admin deletes user's message; tombstone propagates; audit entry recorded", async ({
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
      const admin = new AdminPage(adminPage);

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

      // Admin deletes the user-authored message.
      await adminChat.adminDeleteLatestFrom(USER.username);

      // Both sides see the tombstone.
      await expect(async () => adminChat.expectTombstone(text)).toPass({
        timeout: WS_DELIVERY_MS,
      });
      await expect(async () => userChat.expectTombstone(text)).toPass({
        timeout: WS_DELIVERY_MS,
      });

      // Admin finds the audit-log entry. The audit table renders the actor as
      // "{type} #{id}" (no username column today), so resolve the admin's
      // numeric id from the BFF session before asserting.
      const adminSession = await adminPage.request.get('/api/v1/auth/session');
      expect(adminSession.ok()).toBe(true);
      const adminBody = await adminSession.json();
      const adminMatch = String(adminBody.sub ?? '').match(/^a:(\d+)$/);
      expect(adminMatch, `expected admin sub, got ${adminBody.sub}`).not.toBeNull();
      const adminId = Number(adminMatch![1]);
      await admin.gotoAuditLog();
      await admin.expectAuditLoaded();
      await admin.expectAuditEntryByActorId('message.delete', adminId);
    } finally {
      await userCtx.close();
      await adminCtx.close();
    }
  });
});
