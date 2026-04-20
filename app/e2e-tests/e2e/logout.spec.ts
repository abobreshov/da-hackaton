import { test, expect } from '../fixtures/test';

const USER = { email: 'user@example.com', password: 'User1234!' };

test.describe('Logout flow', () => {
  test('logout clears session cookies and redirects to /login', async ({
    page,
    context,
    loginPage,
    dashboardPage,
  }) => {
    await loginPage.goto();
    await loginPage.expectLoaded();
    await loginPage.login(USER.email, USER.password);
    await dashboardPage.expectLoaded();

    // Sanity: session + refresh cookies were set by the BFF after login.
    const cookiesAfterLogin = await context.cookies();
    const sessionCookieSet = cookiesAfterLogin.some((c) => c.name === 'session');
    const refreshCookieSet = cookiesAfterLogin.some((c) => c.name === 'refresh');
    expect(sessionCookieSet, 'session cookie should be set after login').toBe(true);
    expect(refreshCookieSet, 'refresh cookie should be set after login').toBe(true);

    await dashboardPage.clickLogout();

    // `_auth` layout forces a hard navigation to /login on logout.
    await page.waitForURL(/\/login$/);
    await loginPage.expectLoaded();

    // Both auth cookies must be cleared.
    const cookiesAfterLogout = await context.cookies();
    const stillHasSession = cookiesAfterLogout.some((c) => c.name === 'session');
    const stillHasRefresh = cookiesAfterLogout.some((c) => c.name === 'refresh');
    expect(stillHasSession, 'session cookie should be cleared').toBe(false);
    expect(stillHasRefresh, 'refresh cookie should be cleared').toBe(false);
  });
});
