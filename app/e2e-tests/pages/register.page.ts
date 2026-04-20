import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page object for the `/register` route.
 *
 * Matches the form rendered by `src/frontend/src/routes/register.tsx`:
 *   - Inputs: #email, #username, #password (standard <Label htmlFor>)
 *   - Primary submit button: "Create account"
 *   - Server-level error copy lives inside `div.bg-red-50` with role="alert".
 *   - Field-level validation errors render as `p.text-red-500` next to the input.
 *
 * On success the page calls `setSession(...)` then navigates to `/dashboard`,
 * so `expectDashboardRedirect` just waits for the URL.
 */
export class RegisterPage extends BasePage {
  protected readonly path = '/register';

  readonly heading: Locator;
  readonly emailInput: Locator;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorAlert: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: /create account/i });
    this.emailInput = page.getByLabel(/^email$/i);
    this.usernameInput = page.getByLabel(/^username$/i);
    this.passwordInput = page.getByLabel(/^password$/i);
    this.submitButton = page.getByRole('button', { name: /^create account/i });
    this.errorAlert = page.locator('div.bg-red-50');
  }

  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  async fillForm(email: string, username: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  async expectDashboardRedirect(): Promise<void> {
    await this.waitForUrl(/\/dashboard$/);
  }

  async expectConflictError(): Promise<void> {
    await expect(this.errorAlert).toBeVisible();
    await expect(this.errorAlert).toContainText(/already taken/i);
  }
}
