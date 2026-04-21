import type { Locator, Page, Response } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Page object for the `/rooms/$roomId` route (EPIC-05 + EPIC-02 presence).
 *
 * Expected DOM contract (M2 reviewer journey):
 *   - Route renders a heading with the room name/id.
 *   - Member list container: `[data-testid="room-member-list"]`
 *     with one child `[data-testid="room-member"]` per member. Each member row
 *     carries `data-username="<username>"` to allow per-user assertions.
 *   - Presence indicator nested inside each row at
 *     `[data-testid="presence-dot"]` with `data-state` in
 *     {`online`,`afk`,`offline`} (see EPIC-02 AC-02-01).
 *   - Join / Leave actions exposed as buttons with names "Join" / "Leave"
 *     (case-insensitive regex) — `Join` appears only for non-members, `Leave`
 *     for current members.
 *
 * Selectors intentionally combine `data-testid` (structural) with
 * `data-username` / `data-state` (semantic attributes) so the visual surface
 * can be re-themed without breaking tests.
 *
 * NOTE on presence timing: the spec default for AFK is 60s
 * (AFK_THRESHOLD_SECONDS), which is too slow for an interactive demo. Local
 * e2e runs should export `AFK_THRESHOLD_SECONDS=5` on the backend service to
 * keep the AFK-branch test under the Playwright timeout budget.
 *
 * Note: this page does NOT extend `BasePage` because the M2 route requires a
 * dynamic `roomId` segment, which is incompatible with BasePage.goto()'s
 * no-arg signature. It still follows the same POM shape.
 */
export class RoomDetailPage {
  readonly heading: Locator;
  readonly memberList: Locator;
  readonly joinButton: Locator;
  readonly leaveButton: Locator;

  private currentRoomId?: string;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1 });
    // Current FE renders the sidebar member list as `<ul aria-label="Members">`
    // (see `routes/_auth/rooms/$roomId.tsx`). No `data-testid="room-member-list"`
    // today. Bind via the ARIA label instead.
    this.memberList = page.getByRole('list', { name: /^members$/i });
    this.joinButton = page.getByRole('button', { name: /^join$/i });
    this.leaveButton = page.getByRole('button', { name: /^leave$/i });
  }

  async goto(roomId: string): Promise<Response | null> {
    this.currentRoomId = roomId;
    return this.page.goto(`/rooms/${roomId}`);
  }

  url(): string {
    return this.page.url();
  }

  async expectLoaded(): Promise<void> {
    const id = this.currentRoomId ?? '[^/]+';
    await this.page.waitForURL(new RegExp(`/rooms/${id}$`));
    await expect(this.memberList).toBeVisible();
  }

  /**
   * Returns the member list container locator. Caller can chain:
   *   `page.getMemberList().getByTestId('room-member')` etc.
   */
  getMemberList(): Locator {
    return this.memberList;
  }

  /**
   * Locator for the member row identified by username. Each row is a plain
   * `<li>` carrying the username inside the inner `<UserPopover>` trigger;
   * there is no `data-username` / `data-testid="room-member"` today.
   */
  memberRow(username: string): Locator {
    return this.memberList.getByRole('listitem').filter({ hasText: username });
  }

  /**
   * Locator for the presence dot belonging to a member row.
   *
   * `<PresenceDot>` renders a `<span role="status" aria-label="Online|Away (AFK)|Offline">`
   * with NO `data-testid="presence-dot"` attribute and NO `data-state` attr —
   * the variant is encoded in Tailwind classes only. Tests that previously
   * asserted `toHaveAttribute('data-state', '<state>')` are STRUCTURALLY
   * BLOCKED today; the helpers below assert against the aria-label instead.
   */
  getPresenceDotFor(username: string): Locator {
    return this.memberRow(username).getByRole('status').first();
  }

  async expectMemberOnline(username: string): Promise<void> {
    await expect(this.getPresenceDotFor(username)).toHaveAttribute('aria-label', /online/i);
  }

  async expectMemberAfk(username: string): Promise<void> {
    await expect(this.getPresenceDotFor(username)).toHaveAttribute('aria-label', /away|afk/i);
  }

  async expectMemberOffline(username: string): Promise<void> {
    await expect(this.getPresenceDotFor(username)).toHaveAttribute('aria-label', /offline/i);
  }

  async expectMemberListed(username: string): Promise<void> {
    await expect(this.memberRow(username)).toBeVisible();
  }

  async expectMemberNotListed(username: string): Promise<void> {
    await expect(this.memberRow(username)).toHaveCount(0);
  }

  async joinRoom(): Promise<void> {
    await this.joinButton.click();
  }

  async leaveRoom(): Promise<void> {
    await this.leaveButton.click();
  }
}
