import { test, expect } from '../fixtures/test';

const USER = { email: 'user@example.com', password: 'User1234!' };

/**
 * M1 demo journey — empty rooms catalog.
 *
 * The seeded `user@example.com` is not a member of any seeded rooms, and the
 * BFF's `rooms.catalog` call is expected to return an empty list at MVP
 * baseline. The view should render the shared `EmptyState` component.
 *
 * Finishes by clicking logout to prove the full session lifecycle works for
 * this route (cookie clears + redirect back to /login).
 */
test.describe('Rooms catalog — empty state + logout', () => {
  test('seeded user visits /rooms, sees empty catalog, then logs out', async ({
    page,
    context,
    loginPage,
    dashboardPage,
    roomsPage,
  }) => {
    // 1. Log in as the seeded user.
    await loginPage.goto();
    await loginPage.expectLoaded();
    await loginPage.login(USER.email, USER.password);
    await dashboardPage.expectLoaded();

    // 2. Navigate to the rooms catalog.
    await roomsPage.goto();
    await roomsPage.expectLoaded();
    await roomsPage.expectEmptyCatalog();

    // 3. Logout clears session + refresh cookies and returns to /login.
    await dashboardPage.clickLogout();
    await page.waitForURL(/\/login$/);
    await loginPage.expectLoaded();

    const cookiesAfterLogout = await context.cookies();
    const stillHasSession = cookiesAfterLogout.some((c) => c.name === 'session');
    const stillHasRefresh = cookiesAfterLogout.some((c) => c.name === 'refresh');
    expect(stillHasSession, 'session cookie should be cleared').toBe(false);
    expect(stillHasRefresh, 'refresh cookie should be cleared').toBe(false);
  });
});
