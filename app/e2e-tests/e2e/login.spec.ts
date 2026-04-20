import { test, expect } from '../fixtures/test';

const USER = { email: 'user@example.com', password: 'User1234!' };

test.describe('Login flow', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.expectLoaded();
  });

  test('user logs in and lands on welcome dashboard', async ({ loginPage, dashboardPage }) => {
    await loginPage.login(USER.email, USER.password);

    await dashboardPage.expectLoaded();
    await dashboardPage.expectWelcomeFor(/dev user/i);
    await dashboardPage.expectSignedInAs(USER.email);
    await expect(dashboardPage.scopesSection).toBeVisible();
    await expect(dashboardPage.scopeChip('read:dashboard')).toBeVisible();
  });

  test('invalid credentials show error', async ({ loginPage }) => {
    await loginPage.login(USER.email, 'WrongPass123!');

    await loginPage.expectError();
    expect(loginPage.url()).toContain('/login');
  });

  test('client-side validation blocks short password', async ({ page, loginPage }) => {
    await loginPage.fillCredentials(USER.email, 'short');
    await loginPage.submit();

    await expect(page.getByText(/at least 8/i)).toBeVisible();
  });
});
