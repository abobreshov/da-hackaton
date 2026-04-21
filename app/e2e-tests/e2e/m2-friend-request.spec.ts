import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { ContactsPage } from '../pages/contacts.page';
import { fetchVerifyTokenFromMailpit } from '../helpers/mailpit';

/**
 * M2 demo journey — friend request lifecycle (EPIC-04).
 *
 * Two scenarios, each with its own freshly registered user so the demo seed's
 * pre-accepted `admin↔user` friendship can't short-circuit the flow. The
 * fresh user is minted through the real register → Mailpit verify-email path
 * so the BFF mints the session cookie the same way the UI would.
 *
 * Scenarios:
 *   1. Fresh user requests Dev Admin → admin accepts → both see each other.
 *   2. Fresh user requests Dev Admin → admin rejects → pending row disappears.
 *
 * Exercises AC-04-01..04-04 + the BFF endpoints listed in
 * `mng/specs/04-contacts-friends.md` §API.
 */

const ADMIN = { email: 'admin@example.com', password: 'Admin123!', username: 'admin' };
const WS_PUSH_MS = 3_000;

interface FreshUser {
  email: string;
  username: string;
  password: string;
}

function makeFreshUser(tag: string): FreshUser {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return {
    email: `m2-${tag}-${ts}-${rand}@example.com`,
    username: `m2_${tag}_${ts}_${rand}`,
    password: 'FriendPass-1!',
  };
}

/**
 * Registers a fresh user through the real BFF flow, consumes the verify-email
 * link from Mailpit, and leaves the context authenticated (session cookie
 * set). Mirrors the helper in m5-delete-account-cascade.spec.ts.
 */
async function registerAndVerifyFreshUser(
  page: import('@playwright/test').Page,
  u: FreshUser,
): Promise<void> {
  const registerRes = await page.request.post('/api/v1/auth/register', {
    data: { email: u.email, username: u.username, password: u.password },
  });
  expect(registerRes.status(), 'register returns 202').toBe(202);

  const token = await fetchVerifyTokenFromMailpit(u.email);
  const verifyRes = await page.request.post('/api/v1/auth/verify-email', {
    data: { token },
  });
  expect(verifyRes.status(), 'verify-email succeeds').toBeLessThan(300);
}

test.describe('M2 — friend request lifecycle', () => {
  test('fresh user requests Dev Admin → admin accepts → both see each other', async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const fresh = makeFreshUser('accept');
    const userCtx = await browser.newContext();
    const adminCtx = await browser.newContext();

    try {
      const userPage = await userCtx.newPage();
      const adminPage = await adminCtx.newPage();

      // 1. Bootstrap a verified fresh user (register + Mailpit verify).
      await userPage.goto('/login');
      await registerAndVerifyFreshUser(userPage, fresh);

      // 2. Fresh user opens /contacts and requests admin by username.
      const userContacts = new ContactsPage(userPage);
      await userContacts.goto();
      await userContacts.expectLoaded();
      await userContacts.sendFriendRequest(ADMIN.username);

      // 3. Admin signs in and sees the pending incoming row.
      const adminLogin = new LoginPage(adminPage);
      const adminDash = new DashboardPage(adminPage);
      const adminContacts = new ContactsPage(adminPage);
      await adminLogin.goto();
      await adminLogin.login(ADMIN.email, ADMIN.password);
      await adminDash.expectLoaded();
      await adminContacts.goto();
      await adminContacts.expectLoaded();

      await expect(async () => {
        await adminContacts.expectPendingIncoming(fresh.username);
      }).toPass({ timeout: WS_PUSH_MS });

      // 4. Admin accepts → friend row appears on both sides.
      await adminContacts.acceptRequest(fresh.username);
      await adminContacts.expectFriend(fresh.username);

      await expect(async () => {
        await userContacts.expectFriend(ADMIN.username);
      }).toPass({ timeout: WS_PUSH_MS });
    } finally {
      await userCtx.close();
      await adminCtx.close();
    }
  });

  test('fresh user requests Dev Admin → admin rejects → pending row clears', async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const fresh = makeFreshUser('reject');
    const userCtx = await browser.newContext();
    const adminCtx = await browser.newContext();

    try {
      const userPage = await userCtx.newPage();
      const adminPage = await adminCtx.newPage();

      await userPage.goto('/login');
      await registerAndVerifyFreshUser(userPage, fresh);

      const userContacts = new ContactsPage(userPage);
      await userContacts.goto();
      await userContacts.expectLoaded();
      await userContacts.sendFriendRequest(ADMIN.username);

      const adminLogin = new LoginPage(adminPage);
      const adminDash = new DashboardPage(adminPage);
      const adminContacts = new ContactsPage(adminPage);
      await adminLogin.goto();
      await adminLogin.login(ADMIN.email, ADMIN.password);
      await adminDash.expectLoaded();
      await adminContacts.goto();
      await adminContacts.expectLoaded();

      await expect(async () => {
        await adminContacts.expectPendingIncoming(fresh.username);
      }).toPass({ timeout: WS_PUSH_MS });

      // Reject → the incoming row must clear and no friendship is created.
      await adminContacts.rejectRequest(fresh.username);

      await expect(async () => {
        await adminContacts.expectNoPendingIncoming(fresh.username);
      }).toPass({ timeout: WS_PUSH_MS });
      await adminContacts.expectNotFriend(fresh.username);

      // Fresh user's outgoing pending row must disappear too.
      await expect(async () => {
        await userContacts.expectNotFriend(ADMIN.username);
      }).toPass({ timeout: WS_PUSH_MS });
    } finally {
      await userCtx.close();
      await adminCtx.close();
    }
  });
});
