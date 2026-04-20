import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { ContactsPage } from '../pages/contacts.page';

/**
 * M2 demo journey — friend request lifecycle (EPIC-04).
 *
 * Two browser contexts so each seeded user maintains their own session
 * cookies:
 *  - userCtx  → user@example.com (username `user`)
 *  - adminCtx → admin@example.com (username `admin`)
 *
 * Flow:
 *   1. user sends friend request to admin by username.
 *   2. admin logs in, sees the pending incoming request.
 *   3. admin accepts.
 *   4. Both see each other in their friends list.
 *
 * Exercises AC-04-01..04-04 + the BFF endpoints listed in
 * `mng/specs/04-contacts-friends.md` §API.
 */

const USER = { email: 'user@example.com', password: 'User1234!', username: 'user' };
const ADMIN = { email: 'admin@example.com', password: 'Admin123!', username: 'admin' };

// Matches the WS push SLA from EPIC-03 (≤2s) with a small jitter envelope.
const WS_PUSH_MS = 3_000;

test.describe('M2 — friend request lifecycle', () => {
  test('user requests, admin accepts, both see each other as friend', async ({ browser }) => {
    const userCtx = await browser.newContext();
    const adminCtx = await browser.newContext();

    try {
      const userPage = await userCtx.newPage();
      const adminPage = await adminCtx.newPage();

      const userLogin = new LoginPage(userPage);
      const userDash = new DashboardPage(userPage);
      const userContacts = new ContactsPage(userPage);

      const adminLogin = new LoginPage(adminPage);
      const adminDash = new DashboardPage(adminPage);
      const adminContacts = new ContactsPage(adminPage);

      // --- 1. user signs in, navigates to /contacts, sends a friend request.
      await userLogin.goto();
      await userLogin.login(USER.email, USER.password);
      await userDash.expectLoaded();

      await userContacts.goto();
      await userContacts.expectLoaded();
      await userContacts.sendFriendRequest(ADMIN.username);

      // --- 2. admin signs in and opens /contacts — should see pending.
      await adminLogin.goto();
      await adminLogin.login(ADMIN.email, ADMIN.password);
      await adminDash.expectLoaded();

      await adminContacts.goto();
      await adminContacts.expectLoaded();

      await expect(async () => {
        await adminContacts.expectPendingIncoming(USER.username);
      }).toPass({ timeout: WS_PUSH_MS });

      // --- 3. admin accepts.
      await adminContacts.acceptRequest(USER.username);

      // --- 4. Both sides now have each other as friends.
      // Admin sees `user` in their friends list immediately.
      await adminContacts.expectFriend(USER.username);

      // User's /contacts page was opened before acceptance; allow the WS push
      // (`friend.request.accepted`) to update the list without a manual
      // reload. Polling via toPass covers both eager WS update and any
      // explicit refetch-on-focus hook the FE may add.
      await expect(async () => {
        await userContacts.expectFriend(ADMIN.username);
      }).toPass({ timeout: WS_PUSH_MS });
    } finally {
      await userCtx.close();
      await adminCtx.close();
    }
  });
});
