import type { Locator, Page, Response } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Page object for `/admin/reports` + `/admin/audit-log` (EPIC-10 admin
 * moderation surface).
 *
 * DOM contract reflects the **current FE** (see `routes/_admin/reports.tsx`
 * and `routes/_admin/audit-log.tsx`):
 *   - Reports queue page at `/admin/reports`:
 *       - List: `<ul aria-label="Open reports">`
 *       - Each report is a `<li>` carrying a "Resolve" button + a "Dismiss"
 *         button. The reason text is exposed via
 *         `[data-testid="report-reason-{id}"]`. There is no row-level
 *         data-report-id; we read the report id off the reason testid.
 *   - Audit log page at `/admin/audit-log`:
 *       - Table: `<table aria-label="Audit log entries">`
 *       - Each `<tr>` renders the action inside a `<code>` cell. The actor is
 *         rendered as "{actorType} #{actorId}" — the wire shape doesn't carry
 *         an actor *username*, so `expectAuditEntryBy` has to take the actor
 *         numeric id (resolved by the test against /api/v1/auth/session).
 */
export class AdminPage {
  readonly reportsQueue: Locator;
  readonly auditTable: Locator;

  constructor(private readonly page: Page) {
    this.reportsQueue = page.getByRole('list', { name: /open reports/i });
    this.auditTable = page.getByRole('table', { name: /audit log entries/i });
  }

  async gotoReports(): Promise<Response | null> {
    return this.page.goto('/admin/reports');
  }

  async gotoAuditLog(): Promise<Response | null> {
    return this.page.goto('/admin/audit-log');
  }

  async expectReportsLoaded(): Promise<void> {
    await this.page.waitForURL(/\/admin\/reports$/);
    await expect(this.reportsQueue).toBeVisible();
  }

  async expectAuditLoaded(): Promise<void> {
    await this.page.waitForURL(/\/admin\/audit-log$/);
    await expect(this.auditTable).toBeVisible();
  }

  reportRows(): Locator {
    return this.reportsQueue.getByRole('listitem');
  }

  async expectReportsQueueNonEmpty(): Promise<void> {
    await expect(this.reportRows().first()).toBeVisible();
  }

  /**
   * Resolves the first open report in the queue. Returns the report id
   * scraped from the per-reason testid so callers can correlate against the
   * audit log if needed.
   */
  async resolveFirstReport(): Promise<string | null> {
    const row = this.reportRows().first();
    await expect(row).toBeVisible();
    // Extract the id from the reason testid `report-reason-{id}`.
    const reason = row.locator('[data-testid^="report-reason-"]').first();
    const testid = await reason.getAttribute('data-testid');
    const id = testid ? testid.replace(/^report-reason-/, '') : null;
    await row.getByRole('button', { name: /^resolve$/i }).click();
    return id;
  }

  /**
   * Asserts at least one audit-log row whose Action cell carries the given
   * action string (e.g. "report.resolve"). The action is rendered inside a
   * `<code>` cell, so a row-text match on the action substring is enough.
   */
  async expectAuditEntry(action: string): Promise<void> {
    const row = this.auditTable.locator('tbody tr').filter({ hasText: action });
    await expect(row.first()).toBeVisible();
  }

  /**
   * Asserts at least one audit-log row whose Action AND actor numeric id
   * both match. The FE renders actor as "{type} #{id}" (no username — the
   * audit table works off raw ids), so callers pass the numeric id.
   */
  async expectAuditEntryByActorId(action: string, actorId: number): Promise<void> {
    const row = this.auditTable
      .locator('tbody tr')
      .filter({ hasText: action })
      .filter({ hasText: new RegExp(`#${actorId}\\b`) });
    await expect(row.first()).toBeVisible();
  }
}
