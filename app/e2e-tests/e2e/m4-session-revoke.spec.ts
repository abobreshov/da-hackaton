import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';

/**
 * M4 — T22 session-revoke flow (structural spec).
 *
 * Documents the contract for the active-sessions UI + revoke endpoint.
 * Backend session-management wiring (T23–T26) is not in place yet, so
 * every case is declared with `test.skip` and a reason. CI will report
 * these as `skipped`, not `failing`. Unskip case-by-case as the backend
 * lands and the `/sessions` route + testids ship in the frontend.
 *
 * Selectors documented (do not rename without updating the spec):
 *   - route:   /sessions
 *   - row:     [data-testid="session-row"]
 *   - revoke:  [data-testid="session-revoke-btn"]
 */

const SKIP_REASON = 'AWAITING T23-T26 backend wiring';

const USER = { email: 'user@example.com', password: 'User1234!' };

test.describe('M4 — session revoke', () => {
  test.skip('active sessions list shows the current login row', async ({ page }) => {
    test.info().annotations.push({ type: 'skip-reason', description: SKIP_REASON });

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

  test.skip('revoking a session logs that browser out', async ({ browser }) => {
    test.info().annotations.push({ type: 'skip-reason', description: SKIP_REASON });

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
