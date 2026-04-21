import { test, expect } from '../fixtures/test';

const USER = { email: 'user@example.com', password: 'User1234!' };

/**
 * M1 demo journey — rooms catalog renders + logout round-trip.
 *
 * Historical note: this spec was originally named "empty rooms catalog" and
 * asserted the EmptyState placeholder. The demo seed
 * (`app/src/backend/scripts/seed-demo.ts`) now inserts three public rooms
 * (#general id=1, #random id=2, #demo id=3) before the suite runs, so the
 * catalog is never empty. The assertion was flipped to: heading "Public rooms"
 * is reachable AND at least one room link is visible.
 *
 * Finishes by clicking logout to prove the full session lifecycle works for
 * this route (cookie clears + redirect back to /login).
 */
test.describe('Rooms catalog — populated catalog + logout', () => {
  test('seeded user visits /rooms, sees at least one public room, then logs out', async ({
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

    // 2. Navigate to the rooms catalog. Demo seed inserts general/random/demo,
    //    so the public list must be present and contain at least one link.
    await roomsPage.goto();
    await roomsPage.expectLoaded();
    await roomsPage.expectRoomsList();
    const firstRoomLink = page.locator('a[href^="/rooms/"]').first();
    await expect(firstRoomLink).toBeVisible();

    // Member-count regression — see commit 1723d7b. Seeded rooms must not all
    // show "0 members"; at least one card should report a non-zero count.
    const nonZeroMemberCount = page.getByText(/\b[1-9]\d*\s+members?\b/).first();
    await expect(nonZeroMemberCount).toBeVisible();

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
