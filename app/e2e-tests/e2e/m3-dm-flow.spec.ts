import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { ContactsPage } from '../pages/contacts.page';
import { DmChatPage } from '../pages/dm-chat.page';

/**
 * M3 — DM happy path + block-then-frozen (EPIC-07 AC-07-07 + AC-07-19, EPIC-04
 * user-block invariant).
 *
 * Seed guarantees admin ↔ user friendship is accepted, so DM is allowed.
 *
 * Flow:
 *  1. admin opens /contacts, clicks user's UserPopover → "Open DM". This
 *     navigates to /dm/:userId — no hard-coded id required.
 *  2. admin sends "hi"; user (on /dm/:adminId, reached via their own
 *     contacts popover) sees it.
 *  3. user opens admin's UserPopover in /contacts and clicks "Block".
 *  4. admin returns to the DM — composer is gone / disabled and the frozen
 *     banner is visible.
 */

const USER = { email: 'user@example.com', password: 'User1234!', username: 'user' };
const ADMIN = { email: 'admin@example.com', password: 'Admin123!', username: 'admin' };

const WS_DELIVERY_MS = 3_000;

test.describe('M3 — DM flow with block → frozen', () => {
  test('admin DMs user, user blocks, admin sees frozen banner', async ({ browser }) => {
    const userCtx = await browser.newContext();
    const adminCtx = await browser.newContext();

    try {
      const userPage = await userCtx.newPage();
      const adminPage = await adminCtx.newPage();

      const userLogin = new LoginPage(userPage);
      const userDash = new DashboardPage(userPage);
      const userContacts = new ContactsPage(userPage);
      const userDm = new DmChatPage(userPage);

      const adminLogin = new LoginPage(adminPage);
      const adminDash = new DashboardPage(adminPage);
      const adminContacts = new ContactsPage(adminPage);
      const adminDm = new DmChatPage(adminPage);

      await userLogin.goto();
      await userLogin.login(USER.email, USER.password);
      await userDash.expectLoaded();

      await adminLogin.goto();
      await adminLogin.login(ADMIN.email, ADMIN.password);
      await adminDash.expectLoaded();

      // --- 1. admin opens contacts, uses UserPopover → Open DM on `user`.
      await adminContacts.goto();
      await adminContacts.expectLoaded();
      await adminContacts.expectFriend(USER.username);

      const userRowTrigger = adminPage
        .locator(
          `[data-testid="friend-row"][data-username="${USER.username}"]`,
        )
        .getByTestId('user-popover-trigger');
      await userRowTrigger.click();
      await adminPage.getByTestId('user-popover-action-open-dm').click();
      await adminPage.waitForURL(/\/dm\/\d+$/);
      await adminDm.expectLoaded();

      // --- 2. user symmetrically opens DM to admin.
      await userContacts.goto();
      await userContacts.expectLoaded();
      await userContacts.expectFriend(ADMIN.username);

      const adminRowTrigger = userPage
        .locator(
          `[data-testid="friend-row"][data-username="${ADMIN.username}"]`,
        )
        .getByTestId('user-popover-trigger');
      await adminRowTrigger.click();
      await userPage.getByTestId('user-popover-action-open-dm').click();
      await userPage.waitForURL(/\/dm\/\d+$/);
      await userDm.expectLoaded();

      // admin sends; user receives.
      const helloText = `dm-hello-${Date.now()}`;
      await adminDm.typeAndSend(helloText);
      await expect(userDm.messageByText(helloText).last()).toBeVisible({
        timeout: WS_DELIVERY_MS,
      });

      // --- 3. user blocks admin via contacts popover.
      await userContacts.goto();
      await userContacts.expectLoaded();
      await adminRowTrigger.click();
      await userPage.getByTestId('user-popover-action-block').click();
      // Some popovers require a confirmation submit — tolerate optional.
      const confirmBlock = userPage.getByRole('button', { name: /^(block|confirm)$/i });
      if (await confirmBlock.isVisible().catch(() => false)) {
        await confirmBlock.click();
      }

      // --- 4. admin now sees the frozen banner.
      // Reload the DM route to force-refresh dm.frozen_at read; the FE may
      // also push via WS, but reload is the reliable path regardless.
      await adminPage.reload();
      await expect(async () => adminDm.expectFrozenBanner()).toPass({
        timeout: WS_DELIVERY_MS,
      });
    } finally {
      await userCtx.close();
      await adminCtx.close();
    }
  });
});
