import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page object for the `/register` route.
 *
 * Matches the form rendered by `src/frontend/src/routes/register.tsx`:
 *   - Inputs: #email, #username, #password (standard <Label htmlFor>)
 *   - Primary submit button: "Create account"
 *   - Server-level error copy lives inside the `<FormError>` card rendered with
 *     `role="alert"` and tonal `bg-error-container` (no red border).
 *   - Field-level validation errors also render as `role="alert"` field text.
 *
 * NOTE: Current FE follows OWASP V3.1.1 — register NEVER auto-logs-in. On
 * success the page renders a "Check your inbox" confirmation card with the
 * submitted email echoed back. The user must click the verify-email link to
 * mint a session. `expectDashboardRedirect` is preserved only for flows that
 * *also* go through verify-email (e.g. m5 offline-delivery) — plain
 * `register.submit()` will NOT navigate to /dashboard.
 */
export class RegisterPage extends BasePage {
  protected readonly path = '/register';

  readonly heading: Locator;
  readonly emailInput: Locator;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorAlert: Locator;
  /** "Check your inbox" confirmation surface shown after a successful submit. */
  readonly inboxHeading: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: /create account/i });
    this.emailInput = page.getByLabel(/email address/i);
    this.usernameInput = page.getByLabel(/^username$/i);
    this.passwordInput = page.getByLabel(/^password$/i);
    this.submitButton = page.getByRole('button', { name: /create account|creating account/i });
    // FormError card carries role="alert"; field errors do too. Take the
    // top-level form alert when the submit comes back red.
    this.errorAlert = page.locator('[role="alert"]').first();
    this.inboxHeading = page.getByRole('heading', { name: /check your inbox/i });
  }

  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  async fillForm(email: string, username: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  async expectDashboardRedirect(): Promise<void> {
    await this.waitForUrl(/\/dashboard$/);
  }

  /**
   * Confirms the post-submit "Check your inbox" envelope-safe response copy.
   * Replaces the legacy `expectConflictError` — per OWASP V3.1.1 the FE no
   * longer surfaces a CONFLICT message, so a duplicate-email submit lands on
   * the SAME inbox card as a brand-new email.
   *
   * The FE renders the confirmation inside `<div role="status">` — scope the
   * email assertion to that region so the nested `<span>` echoing the address
   * doesn't race the surrounding `<p>` (Playwright strict mode would otherwise
   * see the email text at both the `<p>` and its `<span>` child).
   */
  async expectInboxConfirmation(email: string): Promise<void> {
    await expect(this.inboxHeading).toBeVisible();
    const status = this.page.getByRole('status');
    await expect(status).toBeVisible();
    await expect(status.getByText(email, { exact: true })).toBeVisible();
  }
}
