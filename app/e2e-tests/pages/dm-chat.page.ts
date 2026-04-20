import type { Locator, Page, Response } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Page object for the `/_auth/dm/$userId` route (EPIC-07 DM surface).
 *
 * Parallel shape to RoomChatPage — same composer + bubble contract, minus the
 * member-list / Manage Room scaffolding. Adds a DM-specific frozen banner
 * that renders when `dm_channels.frozen_at IS NOT NULL` (user-level ban
 * landed on the channel, AC-07-07 + AC-07-19).
 *
 * Expected DOM contract:
 *   - Scrollable viewport: `[data-testid="message-list"]`
 *   - Bubbles: `[data-testid="message-bubble"][data-author="<username>"]`
 *   - Composer: `[data-testid="message-composer-input"]` +
 *     `[data-testid="message-composer-send"]`
 *   - Frozen banner: `[data-testid="dm-frozen-banner"]` visible only when the
 *     channel is frozen; composer MUST be hidden or disabled when present.
 */
export class DmChatPage {
  readonly messageList: Locator;
  readonly composerInput: Locator;
  readonly composerSend: Locator;
  readonly frozenBanner: Locator;

  private currentUserId?: string;

  constructor(private readonly page: Page) {
    this.messageList = page.getByTestId('message-list');
    this.composerInput = page.getByTestId('message-composer-input');
    this.composerSend = page.getByTestId('message-composer-send');
    this.frozenBanner = page.getByTestId('dm-frozen-banner');
  }

  async goto(userId: string): Promise<Response | null> {
    this.currentUserId = userId;
    return this.page.goto(`/dm/${userId}`);
  }

  url(): string {
    return this.page.url();
  }

  async expectLoaded(): Promise<void> {
    const id = this.currentUserId ?? '[^/]+';
    await this.page.waitForURL(new RegExp(`/dm/${id}$`));
    await expect(this.messageList).toBeVisible();
  }

  messageByText(text: string | RegExp): Locator {
    return this.messageList.getByTestId('message-bubble').filter({ hasText: text });
  }

  latestMessage(): Locator {
    return this.messageList.getByTestId('message-bubble').last();
  }

  async typeAndSend(text: string): Promise<void> {
    await this.composerInput.fill(text);
    await this.composerSend.click();
    await expect(this.messageByText(text).last()).toBeVisible();
  }

  async expectMessageVisible(text: string): Promise<void> {
    await expect(this.messageByText(text).last()).toBeVisible();
  }

  async expectFrozenBanner(): Promise<void> {
    await expect(this.frozenBanner).toBeVisible();
    // Composer should be gone or disabled when frozen — accept either.
    const visible = await this.composerInput.isVisible().catch(() => false);
    if (visible) {
      await expect(this.composerInput).toBeDisabled();
    }
  }

  async expectNotFrozen(): Promise<void> {
    await expect(this.frozenBanner).toHaveCount(0);
    await expect(this.composerInput).toBeVisible();
    await expect(this.composerInput).toBeEnabled();
  }
}
