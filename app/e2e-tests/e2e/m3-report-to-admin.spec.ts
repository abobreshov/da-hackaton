import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RoomChatPage } from '../pages/room-chat.page';
import { AdminPage } from '../pages/admin.page';

/**
 * M3 — report-to-admin round-trip (EPIC-06 AC-06-10/11/12).
 *
 * admin sends a message in #general. user reports it. admin opens
 * `/admin/reports`, finds it queued, resolves it. `/admin/audit-log` then
 * shows an entry with `action="report.resolve"` and `actor=admin`.
 */

const USER = { email: 'user@example.com', password: 'User1234!', username: 'user' };
const ADMIN = { email: 'admin@example.com', password: 'Admin123!', username: 'admin' };
// FE route is `/rooms/$roomId` (numeric). Demo seed inserts #general first
// into a clean `rooms` table → bigserial id 1. See backend/scripts/seed-demo.ts.
const ROOM_ID = '1';

const WS_DELIVERY_MS = 3_000;

test.describe('M3 — user reports admin message; admin resolves', () => {
  test('report queued, admin resolves, audit-log entry recorded', async ({ browser }) => {
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

      await adminChat.goto(ROOM_ID);
      await adminChat.expectLoaded();
      await userChat.goto(ROOM_ID);
      await userChat.expectLoaded();

      // --- admin sends bait text.
      const text = `reportable-${Date.now()}`;
      await adminChat.typeAndSend(text);
      await expect(userChat.messageByText(text).last()).toBeVisible({
        timeout: WS_DELIVERY_MS,
      });

      // --- user reports it via the bubble "Report" action.
      await userChat.reportLatestMessage('Spam from admin (e2e fixture)');

      // --- admin sees it queued, resolves.
      await admin.gotoReports();
      await admin.expectReportsLoaded();
      await admin.expectReportsQueueNonEmpty();
      await admin.resolveFirstReport();

      // --- audit-log entry recorded.
      // The audit table renders the actor as "{type} #{id}" (no username), so
      // resolve the admin's numeric id from the BFF session before asserting.
      const adminSession = await adminPage.request.get('/api/v1/auth/session');
      expect(adminSession.ok()).toBe(true);
      const adminBody = await adminSession.json();
      const adminMatch = String(adminBody.sub ?? '').match(/^a:(\d+)$/);
      expect(adminMatch, `expected admin sub, got ${adminBody.sub}`).not.toBeNull();
      const adminId = Number(adminMatch![1]);
      await admin.gotoAuditLog();
      await admin.expectAuditLoaded();
      await admin.expectAuditEntryByActorId('report.resolve', adminId);
    } finally {
      await userCtx.close();
      await adminCtx.close();
    }
  });
});
