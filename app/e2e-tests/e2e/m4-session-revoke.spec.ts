import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';

/**
 * M4 — T22 session-revoke flow.
 *
 * Selectors (do not rename without updating the FE route):
 *   - route:   /sessions
 *   - row:     [data-testid="session-row"]
 *   - revoke:  [data-testid="session-revoke-btn"]
 */

const USER = { email: 'user@example.com', password: 'User1234!' };

test.describe('M4 — session revoke', () => {
  test('active sessions list shows the current login row', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(USER.email, USER.password);

    const dashboard = new DashboardPage(page);
    await dashboard.expectLoaded();

    // Navigate to the future sessions management surface.
    await page.goto('/sessions');

    // Contract: at least one row with the current browser's user-agent string
    // is visible. Real implementation likely renders agent + IP + last-seen.
    const rows = page.locator('[data-testid="session-row"]');
    await expect(rows.first()).toBeVisible();

    const ua = await page.evaluate(() => navigator.userAgent);
    await expect(rows.filter({ hasText: ua.split(' ')[0] }).first()).toBeVisible();
  });

  test('revoking a session logs that browser out', async ({ browser }) => {
    // Two independent browser contexts → two independent sessions for the
    // same user. Revoking session A from session B must invalidate A's
    // cookies; A's next request should 401 and bounce to /login.
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();

    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      const loginA = new LoginPage(pageA);
      const loginB = new LoginPage(pageB);

      await loginA.goto();
      await loginA.login(USER.email, USER.password);
      await new DashboardPage(pageA).expectLoaded();

      await loginB.goto();
      await loginB.login(USER.email, USER.password);
      await new DashboardPage(pageB).expectLoaded();

      // From session B: open the sessions list and revoke the *other* row
      // (i.e. not the currently-authenticated context).
      await pageB.goto('/sessions');
      const rows = pageB.locator('[data-testid="session-row"]');
      await expect(rows).toHaveCount(2);

      // Convention: the row representing "this browser" is excluded from
      // the revoke target by filtering on the "current" badge (or the
      // session id pulled from a cookie). For the structural spec we just
      // click the first revoke button on a non-current row.
      const otherRow = rows.filter({ hasNot: pageB.getByText(/this device/i) }).first();
      await otherRow.locator('[data-testid="session-revoke-btn"]').click();

      // Session A should now be dead. Force a navigation to a protected
      // page; expect a redirect to /login (or a 401 surfaced as the
      // login screen).
      await pageA.goto('/dashboard');
      await expect(pageA).toHaveURL(/\/login/);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
