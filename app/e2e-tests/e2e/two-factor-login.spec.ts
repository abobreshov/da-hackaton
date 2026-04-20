import { test, expect } from '../fixtures/test';

const USER_2FA = { email: 'user2fa@example.com', password: 'Secure2FA!' };

test.describe('Two-factor login UI', () => {
  test('password step transitions to TOTP step for 2FA-enabled user', async ({
    page,
    loginPage,
  }) => {
    await loginPage.goto();
    await loginPage.expectLoaded();

    await loginPage.fillCredentials(USER_2FA.email, USER_2FA.password);
    await loginPage.submit();

    // The BFF returns `{ requires2fa: true }` (NOT a 401) and the frontend
    // swaps the form to the TOTP step. We assert the UI branch only — we do
    // not complete the TOTP challenge (secret is regenerated on every seed).
    await loginPage.expectTotpStep(USER_2FA.email);

    // Credentials inputs should be gone, error alert should not be shown.
    await expect(loginPage.emailInput).toHaveCount(0);
    await expect(loginPage.passwordInput).toHaveCount(0);
    await expect(loginPage.errorAlert).toHaveCount(0);

    // User stays on /login during the TOTP step.
    expect(page.url()).toContain('/login');
  });

  test('TOTP step offers escape hatch back to credentials', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.expectLoaded();

    await loginPage.fillCredentials(USER_2FA.email, USER_2FA.password);
    await loginPage.submit();
    await loginPage.expectTotpStep(USER_2FA.email);

    await loginPage.byRole('button', { name: /use a different account/i }).click();

    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
  });
});
