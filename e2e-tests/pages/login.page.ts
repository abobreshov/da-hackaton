import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './base.page';

export type LoginType = 'admin' | 'user';

export class LoginPage extends BasePage {
  protected readonly path = '/login';

  readonly heading: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly totpInput: Locator;
  readonly submitButton: Locator;
  readonly errorAlert: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: /sign in/i });
    this.emailInput = page.getByLabel(/email/i);
    this.passwordInput = page.getByLabel(/^password$/i);
    this.totpInput = page.getByLabel(/totp/i);
    this.submitButton = page.getByRole('button', { name: /sign in/i });
    this.errorAlert = page.locator('div.bg-red-50');
  }

  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  async selectType(type: LoginType): Promise<void> {
    await this.page.getByRole('button', { name: new RegExp(`^${type}$`, 'i') }).click();
  }

  async fillCredentials(email: string, password: string, totp?: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    if (totp) await this.totpInput.fill(totp);
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  async login(type: LoginType, email: string, password: string, totp?: string): Promise<void> {
    await this.selectType(type);
    await this.fillCredentials(email, password, totp);
    await this.submit();
  }

  async expectError(message?: string | RegExp): Promise<void> {
    await expect(this.errorAlert).toBeVisible();
    if (message) await expect(this.errorAlert).toContainText(message);
  }
}
