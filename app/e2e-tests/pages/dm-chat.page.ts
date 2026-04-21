import type { Locator, Page, Response } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Page object for the `/_auth/dm/$userId` route (EPIC-07 DM surface).
 *
 * DOM contract verified against `src/frontend/src/routes/_auth/dm/$userId.tsx`
 * + `components/chat/message-list.tsx` + `components/chat/message-bubble.tsx`
 * + `components/chat/message-composer.tsx`:
 *   - Route wrapper: `[data-testid="dm-route"]` (page presence check).
 *   - Header heading id="dm-heading" ("Direct message" eyebrow + username).
 *   - Scrollable viewport: `[data-testid="message-list"]`.
 *   - Bubbles: `[data-testid="message-bubble"][data-author="<username>"]`
 *     with `data-message-id`. Edited badge at
 *     `[data-testid="message-bubble-edited"]`.
 *   - Composer is ALWAYS rendered (even when frozen). `textarea` carries
 *     `data-testid="message-composer-input"` and goes `disabled` when frozen;
 *     send button at `[data-testid="message-composer-send"]`.
 *   - Frozen banner: `[data-testid="dm-frozen-banner"]`, `role="alert"`.
 *     Rendered once the FE latches `DM_FROZEN` from a send or initial fetch.
 */
export class DmChatPage {
  readonly dmRoute: Locator;
  readonly messageList: Locator;
  readonly composerInput: Locator;
  readonly composerSend: Locator;
  readonly frozenBanner: Locator;

  private currentUserId?: string;

  constructor(private readonly page: Page) {
    this.dmRoute = page.getByTestId('dm-route');
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
    const id = this.currentUserId ?? '\\d+';
    await this.page.waitForURL(new RegExp(`/dm/${id}$`));
    await expect(this.dmRoute).toBeVisible();
    await expect(this.messageList).toBeVisible();
  }

  messageByText(text: string | RegExp): Locator {
    return this.messageList.getByTestId('message-bubble').filter({ hasText: text });
  }

  /**
   * All bubbles authored by the given username. Bubbles expose
   * `data-author="<username>"` (see MessageBubble forwardRef div).
   */
  messagesByAuthor(username: string): Locator {
    return this.messageList.locator(
      `[data-testid="message-bubble"][data-author="${username}"]`,
    );
  }

  latestMessage(): Locator {
    return this.messageList.getByTestId('message-bubble').last();
  }

  async typeAndSend(text: string): Promise<void> {
    await expect(this.composerInput).toBeEnabled();
    await this.composerInput.fill(text);
    await this.composerSend.click();
    await expect(this.messageByText(text).last()).toBeVisible();
  }

  async expectMessageVisible(text: string): Promise<void> {
    await expect(this.messageByText(text).last()).toBeVisible();
  }

  /**
   * Frozen contract: the FE always mounts the composer but flips it to
   * `disabled` when frozen, so we assert the banner AND a disabled (or hidden)
   * input rather than assuming one layout.
   */
  async expectFrozenBanner(): Promise<void> {
    await expect(this.frozenBanner).toBeVisible();
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
