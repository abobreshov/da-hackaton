import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './base.page';

export class LoginPage extends BasePage {
  protected readonly path = '/login';

  readonly heading: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly totpInput: Locator;
  readonly submitButton: Locator;
  readonly verifyButton: Locator;
  readonly errorAlert: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: /sign in/i });
    this.emailInput = page.getByLabel(/email/i);
    this.passwordInput = page.getByLabel(/^password$/i);
    this.totpInput = page.getByLabel(/verification code/i);
    this.submitButton = page.getByRole('button', { name: /^continue$/i });
    this.verifyButton = page.getByRole('button', { name: /^verify$/i });
    this.errorAlert = page.locator('div.bg-red-50');
  }

  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  async fillCredentials(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
  }

  async fillTotp(code: string): Promise<void> {
    await this.totpInput.fill(code);
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  async submitTotp(): Promise<void> {
    await this.verifyButton.click();
  }

  async login(email: string, password: string, totp?: string): Promise<void> {
    await this.fillCredentials(email, password);
    await this.submit();
    if (totp) {
      await this.totpInput.waitFor({ state: 'visible' });
      await this.fillTotp(totp);
      await this.submitTotp();
    }
  }

  async expectError(message?: string | RegExp): Promise<void> {
    await expect(this.errorAlert).toBeVisible();
    if (message) await expect(this.errorAlert).toContainText(message);
  }

  async expectTotpStep(email?: string): Promise<void> {
    await expect(this.totpInput).toBeVisible();
    await expect(this.verifyButton).toBeVisible();
    if (email) {
      await expect(this.page.getByText(email)).toBeVisible();
    }
  }
}
