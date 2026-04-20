import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './base.page';

export class DashboardPage extends BasePage {
  protected readonly path = '/dashboard';

  readonly welcomeHeading: Locator;
  readonly scopesSection: Locator;

  constructor(page: Page) {
    super(page);
    this.welcomeHeading = page.getByRole('heading', { name: /^hello,/i });
    this.scopesSection = page.getByRole('heading', { name: /scopes/i });
  }

  async expectLoaded(): Promise<void> {
    await this.waitForUrl(/\/dashboard$/);
    await expect(this.welcomeHeading).toBeVisible();
  }

  async expectWelcomeFor(identity: string | RegExp): Promise<void> {
    await expect(this.welcomeHeading).toContainText(identity);
  }

  async expectSignedInAs(email: string): Promise<void> {
    await expect(this.page.getByText(email)).toBeVisible();
  }

  scopeChip(scope: string): Locator {
    return this.page.locator('span.font-mono', { hasText: scope });
  }
}
