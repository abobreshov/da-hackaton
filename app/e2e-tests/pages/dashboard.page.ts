import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './base.page';

export class DashboardPage extends BasePage {
  protected readonly path = '/dashboard';

  readonly welcomeHeading: Locator;
  readonly scopesSection: Locator;
  readonly logoutButton: Locator;

  constructor(page: Page) {
    super(page);
    this.welcomeHeading = page.locator('#dash-hero');
    this.scopesSection = page.getByRole('heading', { name: /your profile/i });
    this.logoutButton = page.getByRole('button', { name: /log out/i });
  }

  async expectLoaded(): Promise<void> {
    await this.waitForUrl(/\/dashboard$/);
    await expect(this.welcomeHeading).toBeVisible();
  }

  async expectWelcomeFor(identity: string | RegExp): Promise<void> {
    await expect(this.welcomeHeading).toContainText(identity);
  }

  async expectSignedInAs(email: string): Promise<void> {
    await expect(this.page.getByText(email).first()).toBeVisible();
  }

  scopeChip(scope: string): Locator {
    return this.page.locator('span.font-mono', { hasText: scope });
  }

  async clickLogout(): Promise<void> {
    await this.logoutButton.click();
  }
}
