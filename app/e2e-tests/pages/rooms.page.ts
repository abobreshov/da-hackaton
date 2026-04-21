import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page object for the `/rooms` catalog view.
 *
 * The view is expected to render a heading ("Rooms") plus either:
 *   - the shared `EmptyState` component with title copy matching /no rooms/i
 *     (see `src/frontend/src/components/empty-state.tsx` — renders an <h3>
 *     with the `title` prop), OR
 *   - a list container with `role="list"` and one `role="listitem"` per room.
 *
 * The selectors target semantic roles rather than CSS so they survive
 * incidental styling churn.
 */
export class RoomsPage extends BasePage {
  protected readonly path = '/rooms';

  readonly heading: Locator;
  readonly emptyStateTitle: Locator;
  readonly list: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: /^rooms$/i });
    // EmptyState renders the title as an <h3>. Current copy: "No public rooms yet".
    this.emptyStateTitle = page.getByRole('heading', { name: /no public rooms/i });
    // FE renders the catalog as `<ul aria-label="Public rooms">`. Scope to it
    // so the heading <ul> in <nav> elsewhere on the page doesn't shadow us.
    this.list = page.getByRole('list', { name: /public rooms/i });
  }

  async expectLoaded(): Promise<void> {
    await this.waitForUrl(/\/rooms$/);
    await expect(this.heading).toBeVisible();
  }

  async expectEmptyCatalog(): Promise<void> {
    await expect(this.emptyStateTitle).toBeVisible();
  }

  async expectRoomsList(): Promise<void> {
    await expect(this.list).toBeVisible();
    await expect(this.list.getByRole('listitem').first()).toBeVisible();
  }
}
