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

  test('happy path: new user submits form and sees the "check your inbox" envelope', async ({
    context,
    registerPage,
  }) => {
    // OWASP V3.1.1 — register no longer auto-logs-in. The user must consume
    // the verify-email link before a session is minted. The UI contract is a
    // confirmation card echoing the submitted email back.
    const suffix = uniqueSuffix();
    const email = `e2e_${suffix}@example.com`;
    const username = `e2e_${suffix}`;
    const password = 'Reg1ster-Me!';

    await registerPage.fillForm(email, username, password);
    await registerPage.submit();

    await registerPage.expectInboxConfirmation(email);
    expect(registerPage.url()).toContain('/register');

    // Session + refresh cookies must NOT be set until verify-email runs.
    const cookies = await context.cookies();
    expect(cookies.some((c) => c.name === 'session')).toBe(false);
    expect(cookies.some((c) => c.name === 'refresh')).toBe(false);
  });

  test('duplicate email is indistinguishable from a fresh register (OWASP V3.1.1)', async ({
    registerPage,
  }) => {
    // The BFF returns the SAME envelope for "user created" and "email already
    // taken" — leaking the difference would expose existence of accounts.
    // The FE therefore renders the same "Check your inbox" card.
    const suffix = uniqueSuffix();
    await registerPage.fillForm(SEEDED_EMAIL, `dup_${suffix}`, 'Another-Pw-42!');
    await registerPage.submit();

    await registerPage.expectInboxConfirmation(SEEDED_EMAIL);
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
