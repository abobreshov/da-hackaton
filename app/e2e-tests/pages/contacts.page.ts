import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page object for the `/contacts` route (EPIC-04).
 *
 * Expected DOM contract (M2 reviewer journey):
 *   - Heading "Contacts" (level 1).
 *   - "Add friend" form: input `#friend-username` (label "Add friend by username")
 *     and a submit button named "Send request" (case-insensitive).
 *   - Friends list: `<ul aria-label="Friends">` with children
 *     `[data-testid="friend-row"][data-username="<u>"]`. Each row exposes a
 *     "Remove" button.
 *   - Pending-incoming list: `<ul aria-label="Incoming requests">`. Rows are
 *     plain `<li>` carrying the requester's username text + "Accept" / "Reject"
 *     buttons (no per-row data-testid in current FE).
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
    this.usernameInput = page.locator('#friend-username');
    this.sendRequestButton = page.getByRole('button', { name: /send request/i });
    this.friendList = page.getByRole('list', { name: /^friends$/i });
    this.pendingIncomingList = page.getByRole('list', { name: /incoming requests/i });
  }

  async expectLoaded(): Promise<void> {
    await this.waitForUrl(/\/contacts$/);
    await expect(this.heading).toBeVisible();
  }

  private friendRow(username: string): Locator {
    return this.friendList.locator(`[data-testid="friend-row"][data-username="${username}"]`);
  }

  private pendingRow(username: string): Locator {
    // FE renders incoming requests as plain <li>'s carrying the requester's
    // username as text — no data-testid / data-username today. Filter the
    // list's listitems by exact username match.
    return this.pendingIncomingList.getByRole('listitem').filter({ hasText: username });
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
