import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page object for the `/contacts` route (EPIC-04).
 *
 * Expected DOM contract (M2 reviewer journey):
 *   - Heading "Contacts" (level 1).
 *   - "Add friend" form: input with `data-testid="friend-username-input"` and
 *     a submit button named "Send request" (case-insensitive).
 *   - Friends list: container `[data-testid="friend-list"]` with children
 *     `[data-testid="friend-row"][data-username="<u>"]`. Each row exposes a
 *     "Remove" button.
 *   - Pending-incoming list: container `[data-testid="pending-incoming-list"]`
 *     with children `[data-testid="friend-request-row"][data-username="<u>"]`.
 *     Each row exposes "Accept" and "Reject" buttons.
 *
 * Matches BFF routes per `mng/specs/04-contacts-friends.md`:
 *   POST /api/v1/friends/request        {username, text?}
 *   POST /api/v1/friends/requests/:id/accept
 *   POST /api/v1/friends/requests/:id/reject
 *   DELETE /api/v1/friends/:userId
 */
export class ContactsPage extends BasePage {
  protected readonly path = '/contacts';

  readonly heading: Locator;
  readonly usernameInput: Locator;
  readonly sendRequestButton: Locator;
  readonly friendList: Locator;
  readonly pendingIncomingList: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: /^contacts$/i });
    this.usernameInput = page.getByTestId('friend-username-input');
    this.sendRequestButton = page.getByRole('button', { name: /send request/i });
    this.friendList = page.getByTestId('friend-list');
    this.pendingIncomingList = page.getByTestId('pending-incoming-list');
  }

  async expectLoaded(): Promise<void> {
    await this.waitForUrl(/\/contacts$/);
    await expect(this.heading).toBeVisible();
  }

  private friendRow(username: string): Locator {
    return this.friendList.locator(`[data-testid="friend-row"][data-username="${username}"]`);
  }

  private pendingRow(username: string): Locator {
    return this.pendingIncomingList.locator(
      `[data-testid="friend-request-row"][data-username="${username}"]`,
    );
  }

  async sendFriendRequest(username: string): Promise<void> {
    await this.usernameInput.fill(username);
    await this.sendRequestButton.click();
  }

  async acceptRequest(fromUsername: string): Promise<void> {
    await this.pendingRow(fromUsername)
      .getByRole('button', { name: /accept/i })
      .click();
  }

  async rejectRequest(fromUsername: string): Promise<void> {
    await this.pendingRow(fromUsername)
      .getByRole('button', { name: /reject/i })
      .click();
  }

  async removeFriend(username: string): Promise<void> {
    await this.friendRow(username)
      .getByRole('button', { name: /remove/i })
      .click();
  }

  async expectFriend(username: string): Promise<void> {
    await expect(this.friendRow(username)).toBeVisible();
  }

  async expectNotFriend(username: string): Promise<void> {
    await expect(this.friendRow(username)).toHaveCount(0);
  }

  async expectPendingIncoming(username: string): Promise<void> {
    await expect(this.pendingRow(username)).toBeVisible();
  }

  async expectNoPendingIncoming(username: string): Promise<void> {
    await expect(this.pendingRow(username)).toHaveCount(0);
  }
}
