import type { Page, Locator, Response } from '@playwright/test';
import { expect } from '@playwright/test';

export abstract class BasePage {
  protected abstract readonly path: string;

  constructor(protected readonly page: Page) {}

  async goto(): Promise<Response | null> {
    return this.page.goto(this.path);
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(this.escapeRegex(this.path)));
  }

  url(): string {
    return this.page.url();
  }

  locator(selector: string): Locator {
    return this.page.locator(selector);
  }

  byLabel(text: string | RegExp): Locator {
    return this.page.getByLabel(text);
  }

  byRole(
    role: Parameters<Page['getByRole']>[0],
    options?: Parameters<Page['getByRole']>[1],
  ): Locator {
    return this.page.getByRole(role, options);
  }

  byText(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }

  async waitForUrl(url: string | RegExp): Promise<void> {
    await this.page.waitForURL(url);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
