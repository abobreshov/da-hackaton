import { test, expect } from '../fixtures/test';

const USER = { email: 'user@example.com', password: 'User1234!' };

test.describe('BFF /api/v1/auth/session endpoint', () => {
  test('returns 200 + user-shaped session after login', async ({
    page,
    loginPage,
    dashboardPage,
  }) => {
    await loginPage.goto();
    await loginPage.expectLoaded();
    await loginPage.login(USER.email, USER.password);
    await dashboardPage.expectLoaded();

    // Call the BFF from the page context so the session cookie is sent.
    const res = await page.request.get('/api/v1/auth/session');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      email: USER.email,
      type: 'user',
    });
    expect(typeof body.name).toBe('string');
    expect(typeof body.userId).toBe('number');
    expect(Array.isArray(body.scopes)).toBe(true);
  });

  test('returns 401 when called without a session cookie', async ({ request }) => {
    // `request` fixture is a clean APIRequestContext with no cookies.
    const res = await request.get('/api/v1/auth/session');
    expect(res.status()).toBe(401);
  });
});
