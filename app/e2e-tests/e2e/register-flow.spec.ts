import { test, expect } from '../fixtures/test';

/**
 * M1 — Registration journey.
 *
 * Seed users in `src/auth-service/scripts/seed.ts`:
 *   admin@example.com, user@example.com, user2fa@example.com
 * Any of those are safe to use for the duplicate-email branch.
 */
const SEEDED_EMAIL = 'user@example.com';

function uniqueSuffix(): string {
  // Avoid collisions when the suite is re-run against a persistent DB: prefix
  // with the test worker index + timestamp + a random slice.
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}${rand}`;
}

test.describe('Registration flow', () => {
  test.beforeEach(async ({ registerPage }) => {
    await registerPage.goto();
    await registerPage.expectLoaded();
  });

  test('happy path: new user registers and lands on dashboard with session cookies', async ({
    context,
    registerPage,
    dashboardPage,
  }) => {
    const suffix = uniqueSuffix();
    const email = `e2e_${suffix}@example.com`;
    const username = `e2e_${suffix}`;
    const password = 'Reg1ster-Me!';

    await registerPage.fillForm(email, username, password);
    await registerPage.submit();

    await registerPage.expectDashboardRedirect();
    await dashboardPage.expectLoaded();

    // BFF should have set both session + refresh cookies on the successful
    // register → auto-login path (see auth.service.ts → register).
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'session');
    const refreshCookie = cookies.find((c) => c.name === 'refresh');
    expect(sessionCookie, 'session cookie should be set after register').toBeDefined();
    expect(refreshCookie, 'refresh cookie should be set after register').toBeDefined();
  });

  test('duplicate email surfaces the 409 copy', async ({ registerPage }) => {
    // Seeded account — auth-service will return ErrorCode.CONFLICT.
    const suffix = uniqueSuffix();
    await registerPage.fillForm(SEEDED_EMAIL, `dup_${suffix}`, 'Another-Pw-42!');
    await registerPage.submit();

    await registerPage.expectConflictError();
    expect(registerPage.url()).toContain('/register');
  });

  test('client-side validation blocks short password', async ({ page, registerPage }) => {
    const suffix = uniqueSuffix();
    await registerPage.fillForm(`short_${suffix}@example.com`, `short_${suffix}`, 'short');
    await registerPage.submit();

    // zod schema emits "Password must be at least 8 characters".
    await expect(page.getByText(/at least 8/i)).toBeVisible();
    expect(registerPage.url()).toContain('/register');
  });
});
