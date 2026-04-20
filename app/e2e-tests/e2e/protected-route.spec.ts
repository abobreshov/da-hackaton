import { test, expect } from '../fixtures/test';

test.describe('Protected route gating', () => {
  test('/dashboard redirects anonymous visitors to /login', async ({
    page,
    context,
    loginPage,
  }) => {
    // Start from a clean slate — no session cookies in the jar.
    await context.clearCookies();

    await page.goto('/dashboard');

    // The `_auth` layout's `beforeLoad` throws `redirect({ to: '/login' })`
    // when the session fetch fails.
    await page.waitForURL(/\/login$/);
    await loginPage.expectLoaded();
    expect(page.url()).toContain('/login');
  });
});
