import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { ContactsPage } from '../pages/contacts.page';
import { DmChatPage } from '../pages/dm-chat.page';

/**
 * M4 — EPIC-09 unread badge fan-out.
 *
 * Two browsers. Admin sends a DM to user. User is on /contacts (NOT viewing
 * the DM) and sees the per-friend unread badge bump live via the
 * `unread.changed` WS broadcast. User then opens the DM; auto-mark-read
 * fires and the badge clears.
 *
 * Covers:
 *   - GET /unread hydrate on mount
 *   - `unread.changed` WS delta for DMs keyed by peerUserId
 *   - `useAutoMarkRead` optimistic badge clear + POST /dms/:userId/read
 *   - 99+ overflow is unit-tested separately (UnreadBadge spec)
 */

const ADMIN = { email: 'admin@example.com', password: 'Admin123!', username: 'admin' };
const USER = { email: 'user@example.com', password: 'User1234!', username: 'user' };

const WS_DELIVERY_MS = 3_000;

test.describe('M4 — unread badge round-trip', () => {
  test('DM arrives while peer is on /contacts → badge appears → opening DM clears it', async ({
    browser,
  }) => {
    const adminCtx = await browser.newContext();
    const userCtx = await browser.newContext();

    try {
      const adminPage = await adminCtx.newPage();
      const userPage = await userCtx.newPage();

      // Log both in. Seed guarantees admin ↔ user are friends.
      const adminLogin = new LoginPage(adminPage);
      const userLogin = new LoginPage(userPage);
      await adminLogin.goto();
      await adminLogin.login(ADMIN.email, ADMIN.password);
      await userLogin.goto();
      await userLogin.login(USER.email, USER.password);

      // User parks on /contacts so the DM-open auto-mark-read doesn't fire.
      const userContacts = new ContactsPage(userPage);
      await userContacts.goto();
      await userContacts.expectLoaded();
      await userContacts.expectFriend(ADMIN.username);

      // Admin opens DM to user via contacts popover → sends a message.
      const adminContacts = new ContactsPage(adminPage);
      await adminContacts.goto();
      await adminContacts.expectLoaded();
      const userRowTrigger = adminPage
        .locator(`[data-testid="friend-row"][data-username="${USER.username}"]`)
        .getByTestId('user-popover-trigger');
      await userRowTrigger.click();
      await adminPage.getByTestId('user-popover-action-open-dm').click();
      await adminPage.waitForURL(/\/dm\/\d+$/);

      const adminDm = new DmChatPage(adminPage);
      await adminDm.expectLoaded();
      const greeting = `unread-hello-${Date.now()}`;
      await adminDm.typeAndSend(greeting);

      // Back on user's /contacts tab, the badge on admin's row should bump.
      const adminBadge = userPage
        .locator(`[data-testid="friend-row"][data-username="${ADMIN.username}"]`)
        .getByRole('status', { name: /unread/i });

      await expect(adminBadge).toBeVisible({ timeout: WS_DELIVERY_MS });
      await expect(adminBadge).toHaveText(/^\d+\+?$/);

      // User clicks into the DM — auto-mark-read should fire, zeroing the count.
      await userRowTriggerOnUserSide(userPage).click();
      await userPage.getByTestId('user-popover-action-open-dm').click();
      await userPage.waitForURL(/\/dm\/\d+$/);

      const userDm = new DmChatPage(userPage);
      await userDm.expectLoaded();
      await expect(userDm.messageByText(greeting).last()).toBeVisible({
        timeout: WS_DELIVERY_MS,
      });

      // Return to /contacts — the admin row's badge is gone (count == 0 → no
      // badge renders; UnreadBadge returns null for zero).
      await userContacts.goto();
      await userContacts.expectLoaded();
      await expect(adminBadge).toHaveCount(0);
    } finally {
      await adminCtx.close();
      await userCtx.close();
    }
  });
});

function userRowTriggerOnUserSide(userPage: import('@playwright/test').Page) {
  return userPage
    .locator(`[data-testid="friend-row"][data-username="${ADMIN.username}"]`)
    .getByTestId('user-popover-trigger');
}
