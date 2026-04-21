import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page object for the `/contacts` route (EPIC-04).
 *
 * DOM contract verified against `src/frontend/src/routes/_auth/contacts.tsx`:
 *   - Heading "Contacts" (level 1, inside `<header>`).
 *   - "Add friend" form: input `#friend-username` (label "Add friend by username")
 *     and a submit button named "Send request" (case-insensitive).
 *   - Friends list: `<ul aria-label="Friends">` with children
 *     `<li data-testid="friend-row" data-username data-user-id>`. Each row has:
 *       * `<UserPopover>` wrapper → `button[data-testid="user-popover-trigger"]`
 *         which in turn wraps the `<PresenceDot data-testid="presence-dot">`
 *         and the username span.
 *       * `<UnreadBadge>` (`role="status"`, aria-label "<n> unread from <u>") —
 *         renders ONLY when count > 0 (component returns null for zero).
 *       * "Remove" button.
 *   - Incoming-requests list: `<ul aria-label="Incoming requests">`. Rows are
 *     plain `<li>` carrying the requester's username text + "Accept" / "Reject"
 *     buttons (no per-row data-testid in current FE).
 *   - Outgoing-requests list: `<ul aria-label="Outgoing requests">` — read-only.
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
  readonly outgoingList: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: /^contacts$/i });
    this.usernameInput = page.locator('#friend-username');
    this.sendRequestButton = page.getByRole('button', { name: /send request/i });
    this.friendList = page.getByRole('list', { name: /^friends$/i });
    this.pendingIncomingList = page.getByRole('list', { name: /incoming requests/i });
    this.outgoingList = page.getByRole('list', { name: /outgoing requests/i });
  }

  async expectLoaded(): Promise<void> {
    await this.waitForUrl(/\/contacts$/);
    await expect(this.heading).toBeVisible();
  }

  /**
   * Friend row locator. Scoped to `<ul aria-label="Friends">` + matched by
   * `data-testid="friend-row"` + `data-username`. Public so specs can reach
   * per-row children (popover trigger, presence dot, unread badge) without
   * duplicating the selector.
   */
  friendRow(username: string): Locator {
    return this.friendList.locator(`[data-testid="friend-row"][data-username="${username}"]`);
  }

  /**
   * Incoming-request row locator. FE renders plain `<li>` carrying the
   * requester's username — filter listitems by text match.
   */
  pendingRow(username: string): Locator {
    return this.pendingIncomingList.getByRole('listitem').filter({ hasText: username });
  }

  /** UserPopover trigger button within a friend row. */
  friendPopoverTrigger(username: string): Locator {
    return this.friendRow(username).getByTestId('user-popover-trigger');
  }

  /** PresenceDot locator within a friend row (EPIC-02 AC-02-01 data-state). */
  friendPresenceDot(username: string): Locator {
    return this.friendRow(username).getByTestId('presence-dot');
  }

  /**
   * UnreadBadge within a friend row. Falls back to role=status + /unread/i
   * because the badge renders null when count is 0 (AC-09-03).
   */
  friendUnreadBadge(username: string): Locator {
    return this.friendRow(username).getByRole('status', { name: /unread/i });
  }

  async sendFriendRequest(username: string): Promise<void> {
    await this.usernameInput.fill(username);
    await this.sendRequestButton.click();
  }

  /**
   * Opens the UserPopover for a friend row and clicks "Open DM". Used by the
   * M3/M4 flows where there's no standalone "Open DM" button on the row —
   * DM navigation lives behind the popover.
   */
  async openDmFromFriend(username: string): Promise<void> {
    await this.friendPopoverTrigger(username).click();
    await this.page.getByTestId('user-popover-action-open-dm').click();
    await this.page.waitForURL(/\/dm\/\d+$/);
  }

  /**
   * Opens the UserPopover for a friend row and clicks "Block". Tolerates an
   * optional confirmation dialog (current FE runs without one but keep room
   * for future confirm step).
   */
  async blockFriend(username: string): Promise<void> {
    await this.friendPopoverTrigger(username).click();
    await this.page.getByTestId('user-popover-action-block').click();
    const confirm = this.page.getByRole('button', { name: /^(block|confirm)$/i });
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click();
    }
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
    // Use exact name "Remove" — "Remove friend" inside the UserPopover dialog
    // also matches /remove/i and would trip strict-mode violations when the
    // popover happens to be open.
    await this.friendRow(username)
      .getByRole('button', { name: /^remove$/i })
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

  async expectFriendPresence(
    username: string,
    state: 'online' | 'afk' | 'offline',
  ): Promise<void> {
    await expect(this.friendPresenceDot(username)).toHaveAttribute('data-state', state);
  }

  async expectUnreadBadgeVisible(username: string): Promise<void> {
    await expect(this.friendUnreadBadge(username)).toBeVisible();
  }

  async expectNoUnreadBadge(username: string): Promise<void> {
    // UnreadBadge returns null when count is 0 — assert no element rendered.
    await expect(this.friendUnreadBadge(username)).toHaveCount(0);
  }
}
