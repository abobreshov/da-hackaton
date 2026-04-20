import type { Locator, Page, Response } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Page object for `/admin/reports` + `/admin/audit-log` (EPIC-06 admin
 * moderation surface).
 *
 * Expected DOM contract:
 *   - Reports queue page at `/admin/reports`:
 *       - Container `[data-testid="admin-reports-queue"]`
 *       - One row per report: `[data-testid="admin-report-row"]` with
 *         `data-report-id` and a "Resolve" button (and "Dismiss").
 *   - Audit log page at `/admin/audit-log`:
 *       - Table `[data-testid="admin-audit-table"]`
 *       - Rows `[data-testid="admin-audit-row"]` with
 *         `data-action="<action>"` and `data-actor="<username>"`.
 */
export class AdminPage {
  readonly reportsQueue: Locator;
  readonly auditTable: Locator;

  constructor(private readonly page: Page) {
    this.reportsQueue = page.getByTestId('admin-reports-queue');
    this.auditTable = page.getByTestId('admin-audit-table');
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
    return this.reportsQueue.getByTestId('admin-report-row');
  }

  async expectReportsQueueNonEmpty(): Promise<void> {
    await expect(this.reportRows().first()).toBeVisible();
  }

  /**
   * Resolves the first open report in the queue. Returns the
   * `data-report-id` attribute of the row we acted on so callers can
   * cross-reference audit-log entries if needed.
   */
  async resolveFirstReport(): Promise<string | null> {
    const row = this.reportRows().first();
    await expect(row).toBeVisible();
    const id = await row.getAttribute('data-report-id');
    await row.getByRole('button', { name: /^resolve$/i }).click();
    // Optional note dialog — submit with empty/default note if it appears.
    const submit = this.page.getByRole('button', { name: /^(submit|confirm)$/i });
    if (await submit.isVisible().catch(() => false)) {
      await submit.click();
    }
    return id;
  }

  async expectAuditEntry(action: string): Promise<void> {
    const row = this.auditTable.locator(
      `[data-testid="admin-audit-row"][data-action="${action}"]`,
    );
    await expect(row.first()).toBeVisible();
  }

  async expectAuditEntryBy(action: string, actorUsername: string): Promise<void> {
    const row = this.auditTable.locator(
      `[data-testid="admin-audit-row"][data-action="${action}"][data-actor="${actorUsername}"]`,
    );
    await expect(row.first()).toBeVisible();
  }
}
