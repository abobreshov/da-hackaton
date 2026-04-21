import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { RoomDetailPage } from './room-detail.page';

/**
 * Page object for the chat viewport in the `/_auth/rooms/$roomId` route
 * (EPIC-07 messaging surface). Extends RoomDetailPage so tests that already
 * rely on member-list / presence selectors keep working; adds the messaging
 * DOM contract on top.
 *
 * Expected DOM contract (M3 messaging journey):
 *   - Scrollable message viewport: `[data-testid="message-list"]`
 *   - One child per message: `[data-testid="message-bubble"]` carrying
 *     `data-message-id="<id>"` and `data-author="<username>"` so assertions
 *     can target the latest-from-user bubble.
 *   - Composer: `[data-testid="message-composer-input"]` (contenteditable or
 *     textarea) + `[data-testid="message-composer-send"]` submit button.
 *   - Edit mode: bubble exposes an "Edit" action (context menu / hover
 *     toolbar). After edit, bubble renders "(edited)" indicator copy.
 *   - Delete: bubble exposes a "Delete" action. Tombstone placeholder replaces
 *     body with copy matching /message deleted/i.
 *   - Reply: bubble exposes "Reply" action; the composer then shows a
 *     `[data-testid="reply-preview"]` strip. Sent replies render a
 *     `[data-testid="reply-quote"]` sub-region with the parent snippet. When
 *     parent is deleted, quote copy becomes /replying to deleted message/i.
 *   - Report: bubble action "Report" opens a dialog with a reason textarea
 *     + submit button named "Submit report".
 *   - Manage Room modal: `[data-testid="manage-room-modal"]` with tab
 *     triggers `[data-testid="manage-room-tab-{overview|members|invites|
 *     banned|danger}"]`. Header button "Manage room" opens the modal.
 *
 * Selectors prefer `data-testid` for structural nodes so the Kinetic
 * Playground re-theme can swap classes freely.
 */
export class RoomChatPage extends RoomDetailPage {
  readonly messageList: Locator;
  readonly composerInput: Locator;
  readonly composerSend: Locator;
  readonly manageRoomButton: Locator;
  readonly manageRoomModal: Locator;
  readonly replyPreview: Locator;

  constructor(page: Page) {
    super(page);
    this.messageList = page.getByTestId('message-list');
    this.composerInput = page.getByTestId('message-composer-input');
    this.composerSend = page.getByTestId('message-composer-send');
    // FE: <Button data-testid="room-manage-button"> — binding to the testid is
    // more robust than a role+name regex (the modal also exposes a "Manage
    // Room" header label + "Manage Room" dialog title, which can collide).
    this.manageRoomButton = page.getByTestId('room-manage-button');
    this.manageRoomModal = page.getByTestId('manage-room-modal');
    this.replyPreview = page.getByTestId('reply-preview');
  }

  // Any bubble matching the given text. Scoped inside `message-list` so we
  // do not accidentally hit a quote preview elsewhere on the page.
  messageByText(text: string | RegExp): Locator {
    return this.messageList.getByTestId('message-bubble').filter({ hasText: text });
  }

  latestMessage(): Locator {
    return this.messageList.getByTestId('message-bubble').last();
  }

  latestMessageBy(username: string): Locator {
    return this.messageList
      .locator(`[data-testid="message-bubble"][data-author="${username}"]`)
      .last();
  }

  /**
   * Type into composer + click send. Waits for the bubble containing `text`
   * to show up in the viewport so callers can chain other assertions.
   */
  async typeAndSend(text: string): Promise<void> {
    await this.composerInput.fill(text);
    await this.composerSend.click();
    await expect(this.messageByText(text).last()).toBeVisible();
  }

  /**
   * Edit the most recent message authored by the current user. Relies on the
   * bubble exposing hover/context-menu "Edit" action that swaps the bubble
   * into an inline editor. Implementation uses the bubble-scoped "Edit"
   * button — FE agent: that button must exist on every self-authored bubble.
   */
  async editLatestMessage(newText: string): Promise<void> {
    const bubble = this.latestMessage();
    await bubble.getByRole('button', { name: /^edit$/i }).click();
    const editor = bubble.getByTestId('message-edit-input');
    await editor.fill(newText);
    await bubble.getByRole('button', { name: /^save$/i }).click();
  }

  async deleteLatestMessage(): Promise<void> {
    const bubble = this.latestMessage();
    await bubble.getByRole('button', { name: /^delete$/i }).click();
    // Confirmation dialog — FE renders `[data-testid="confirm-delete-dialog"]`
    // with a "Delete" primary + "Cancel" secondary button pair. Scope to the
    // dialog so we don't double-hit the bubble-toolbar "Delete" that triggered
    // it in the first place.
    const dialog = this.messageList.page().getByTestId('confirm-delete-dialog');
    await dialog.getByRole('button', { name: /^delete$/i }).click();
  }

  async replyToLatestMessage(replyText: string): Promise<void> {
    const bubble = this.latestMessage();
    await bubble.getByRole('button', { name: /^reply$/i }).click();
    await expect(this.replyPreview).toBeVisible();
    await this.typeAndSend(replyText);
  }

  async reportLatestMessage(reason: string): Promise<void> {
    const bubble = this.latestMessage();
    await bubble.getByRole('button', { name: /^report$/i }).click();
    // Scope to the report-message dialog testid; other dialogs (confirm-delete,
    // manage-room) may also be mounted on the same page.
    const dialog = this.messageList.page().getByTestId('report-message-dialog');
    await dialog.getByTestId('report-message-reason').fill(reason);
    await dialog.getByRole('button', { name: /submit report/i }).click();
  }

  async adminDeleteLatestFrom(username: string): Promise<void> {
    const bubble = this.latestMessageBy(username);
    await bubble.getByRole('button', { name: /^delete$/i }).click();
    const dialog = this.messageList.page().getByTestId('confirm-delete-dialog');
    await dialog.getByRole('button', { name: /^delete$/i }).click();
  }

  async expectMessageVisible(text: string): Promise<void> {
    await expect(this.messageByText(text).last()).toBeVisible();
  }

  async expectEdited(text: string): Promise<void> {
    const bubble = this.messageByText(text).last();
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText(/\(edited\)/i);
  }

  async expectTombstone(_prevText: string): Promise<void> {
    // After delete, the bubble body is swapped for tombstone copy. We assert
    // at least one tombstone is visible inside the list — callers that need
    // a specific row should pass a data-message-id locator separately.
    await expect(
      this.messageList
        .getByTestId('message-bubble')
        .filter({ hasText: /message deleted|deleted message/i })
        .first(),
    ).toBeVisible();
  }

  async expectReplyQuote(parentSnippet: string | RegExp): Promise<void> {
    // FE testid is `message-bubble-reply-quote` — the inner reply-quote strip
    // rendered inside each <MessageBubble>. See `components/chat/message-bubble.tsx`.
    const quote = this.messageList.getByTestId('message-bubble-reply-quote').last();
    await expect(quote).toBeVisible();
    await expect(quote).toContainText(parentSnippet);
  }

  async expectReplyQuoteDeleted(): Promise<void> {
    const quote = this.messageList.getByTestId('message-bubble-reply-quote').last();
    await expect(quote).toBeVisible();
    await expect(quote).toContainText(/replying to deleted message/i);
  }

  async scrollUp(): Promise<void> {
    await this.messageList.evaluate((el: HTMLElement) => {
      el.scrollTop = 0;
    });
  }

  async countMessages(): Promise<number> {
    return this.messageList.getByTestId('message-bubble').count();
  }

  /**
   * Scrolls to the top of the viewport and waits until the bubble count has
   * grown by at least `count`, which the FE should do by fetching an older
   * keyset page (EPIC-07 AC-07-20).
   */
  async expectLoadedOlder(count: number): Promise<void> {
    const before = await this.countMessages();
    await this.scrollUp();
    await expect
      .poll(async () => this.countMessages(), { timeout: 5_000 })
      .toBeGreaterThanOrEqual(before + count);
  }

  async openManageRoomModal(): Promise<void> {
    await this.manageRoomButton.click();
    await expect(this.manageRoomModal).toBeVisible();
  }

  /**
   * The current FE renders five tabs under `data-testid="manage-room-tab-*"`:
   *   members | admins | banned | invitations | settings
   * (see `components/rooms/manage-room-modal.tsx`). Earlier drafts of the
   * spec referenced "overview" / "invites" / "danger" — those buckets were
   * folded into Members + Invitations + Settings respectively.
   */
  manageRoomTab(name: 'members' | 'admins' | 'banned' | 'invitations' | 'settings'): Locator {
    return this.messageList.page().getByTestId(`manage-room-tab-${name}`);
  }

  async switchManageRoomTab(
    name: 'members' | 'admins' | 'banned' | 'invitations' | 'settings',
  ): Promise<void> {
    await this.manageRoomTab(name).click();
  }

  /**
   * Inside the Members tab: ban a member by their numeric user id. The FE
   * renders the per-row action as a `<Button>` carrying
   * `data-testid="manage-room-member-ban-btn"` + `data-member-id={userId}`
   * (see `components/rooms/manage-room-modal.tsx` MembersTab). The testid is
   * not id-suffixed, so we filter the row-button locator by the `data-member-id`
   * attribute to pin the correct target.
   *
   * Callers must resolve the id (e.g. via `/api/v1/auth/session` for self, or
   * the room member list response for others) before invoking this helper.
   */
  async banMemberById(userId: number): Promise<void> {
    await this.manageRoomModal
      .locator(`[data-testid="manage-room-member-ban-btn"][data-member-id="${userId}"]`)
      .click();
  }

  async unbanById(userId: number): Promise<void> {
    // Banned-tab unban control: `[data-testid="manage-room-banned-unban-btn"]`
    // + `data-member-id={userId}` (see ManageRoomModal BannedTab).
    await this.manageRoomModal
      .locator(`[data-testid="manage-room-banned-unban-btn"][data-member-id="${userId}"]`)
      .click();
  }

  /**
   * Banned-tab entries render as plain `<li>` rows under
   * `<ul aria-label="Banned users">` carrying the username as text — no
   * row-level testid today, so we filter by visible username text.
   */
  async expectBannedListed(username: string): Promise<void> {
    const bannedList = this.manageRoomModal.getByRole('list', { name: /banned users/i });
    await expect(bannedList.getByRole('listitem').filter({ hasText: username }).first()).toBeVisible();
  }
}
