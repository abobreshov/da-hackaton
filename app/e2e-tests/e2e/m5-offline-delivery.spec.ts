import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../fixtures/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { DmChatPage } from '../pages/dm-chat.page';

/**
 * M5 — Offline DM delivery (brief §2.5.6, EPIC-03 AC).
 *
 * Proves a DM sent while the recipient's WS is disconnected is delivered on
 * reconnect — either through the initial history fetch or via sync.since
 * after the socket resumes. Acceptance is scope-agnostic: so long as the
 * offline-era message eventually renders in the DM viewport after B returns,
 * the durable-delivery invariant holds.
 *
 * NOTE: post-OWASP V3.1.1 the register endpoint no longer auto-logs-in, so
 * registering a fresh recipient B and immediately driving them through the
 * UI is no longer viable (no session is minted until verify-email runs).
 * The simplest in-suite fix is to fall back on the seeded user pair —
 *   A = admin@example.com (admin, 2FA REQUIRED — TOTP read from the
 *       gitignored .seed-totp.txt that auth-service's seed.ts emits)
 *   B = user@example.com  (regular user, no 2FA, friended with admin by seed)
 * This sidesteps the register/verify dance entirely while still exercising
 * the durable-delivery path: B opens the DM, leaves, A keeps sending, B comes
 * back in a fresh context and the offline-era message must render.
 *
 * The seeded admin↔user friendship (see src/auth-service/scripts/seed.ts and
 * the m3-dm-flow spec which relies on the same invariant) means the DM is
 * allowed by the friendship gate.
 *
 * Scenario:
 *   1. Resolve admin's numeric id by logging in once and reading
 *      /api/v1/auth/session. Same for user. Both are durable IDs across runs
 *      (SERIAL primary key, ON CONFLICT DO UPDATE in seed) but we re-read
 *      every run to avoid hard-coding fragile ids.
 *   2. Context A (admin) stays logged in for the whole test.
 *   3. Context B1 (user) opens DM /dm/<adminId>, A posts `hello`, B1 sees it.
 *   4. B1 closes — recipient goes "offline" (no WS).
 *   5. A posts an `offline-<ts>` message via /api/v1/messages.
 *   6. Brand-new context B2 (user) logs back in, opens the DM, the offline
 *      message must render — history fetch or sync.since, either path
 *      satisfies EPIC-03.
 */

const ADMIN = { email: 'admin@example.com', password: 'Admin123!' };
const USER_B = { email: 'user@example.com', password: 'User1234!' };

const WS_DELIVERY_MS = 3_000;
const OFFLINE_SYNC_MS = 5_000;

/** Path to the gitignored seed-emitted TOTP secrets file (admin + user2fa). */
const SEED_TOTP_PATH = resolve(
  __dirname,
  '../../src/auth-service/scripts/.seed-totp.txt',
);

/**
 * Read the admin's TOTP secret freshly written by `yarn workspace
 * @app/auth-service seed`. The file is regenerated on every seed run and
 * never committed. If the file is missing, the seed step was skipped — fail
 * loudly so the suite operator re-runs `seed` rather than silently produce
 * a misleading auth failure.
 */
function readAdminTotpSecret(): string {
  let raw: string;
  try {
    raw = readFileSync(SEED_TOTP_PATH, 'utf8');
  } catch (err) {
    throw new Error(
      `m5-offline-delivery: missing ${SEED_TOTP_PATH}. ` +
        `Run \`yarn workspace @app/auth-service seed\` to generate the admin TOTP secret.`,
    );
  }
  const match = raw.match(/^ADMIN_TOTP_SECRET=([A-Z2-7]+)\s*$/m);
  if (!match) {
    throw new Error(
      `m5-offline-delivery: ADMIN_TOTP_SECRET not found in ${SEED_TOTP_PATH}.`,
    );
  }
  return match[1];
}

/** RFC 4648 base32 decoder (uppercase, no padding) — otplib-compatible input. */
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = input.replace(/=+$/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new Error(`base32Decode: invalid char ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/**
 * RFC 6238 TOTP generator (SHA-1, 30-second step, 6-digit code) — matches
 * `otplib.authenticator.generate(secret)` used by auth-service so we can
 * sign in to a 2FA-protected account without adding `otplib` to the e2e
 * package. Inline because the suite already runs in Node and we want zero
 * new deps.
 */
function totp(secretBase32: string, when: number = Date.now()): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(when / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}

/**
 * Resolve the numeric u:<id> for the BFF session sub claim from a logged-in
 * page. Mirrors the m3-dm-flow / former m5 bootstrap pattern — the BFF only
 * exposes the OIDC-style `sub`, not a flat userId.
 */
async function resolveUserId(page: import('@playwright/test').Page): Promise<number> {
  const res = await page.request.get('/api/v1/auth/session');
  expect(res.ok(), `session fetch failed: ${res.status()}`).toBe(true);
  const body = await res.json();
  const m = String(body.sub ?? '').match(/^u:(\d+)$/);
  expect(m, `session sub malformed: ${body.sub}`).not.toBeNull();
  return Number(m![1]);
}

/** Log in as admin (2FA required) using a TOTP code derived from the seed file. */
async function loginAdmin(login: LoginPage): Promise<void> {
  await login.goto();
  await login.expectLoaded();
  await login.fillCredentials(ADMIN.email, ADMIN.password);
  await login.submit();
  await login.totpInput.waitFor({ state: 'visible' });
  await login.fillTotp(totp(readAdminTotpSecret()));
  await login.submitTotp();
}

test.describe('M5 — offline DM delivery', () => {
  test('message sent while recipient WS is disconnected renders on reconnect (brief §2.5.6, EPIC-03)', async ({
    browser,
  }) => {
    // --- 1. Context A (admin) — logs in and stays connected for the entire
    //        scenario. We capture admin's numeric id for B's /dm/<adminId>
    //        navigation and post sends through /api/v1/messages.
    const ctxA = await browser.newContext();
    let adminId: number;
    let userBId: number;
    try {
      const pageA = await ctxA.newPage();
      const loginA = new LoginPage(pageA);
      const dashA = new DashboardPage(pageA);

      await loginAdmin(loginA);
      await dashA.expectLoaded();
      adminId = await resolveUserId(pageA);

      // Resolve B's id via a transient context so A's session isn't disturbed.
      const idCtx = await browser.newContext();
      try {
        const idPage = await idCtx.newPage();
        const idLogin = new LoginPage(idPage);
        const idDash = new DashboardPage(idPage);

        await idLogin.goto();
        await idLogin.expectLoaded();
        await idLogin.login(USER_B.email, USER_B.password);
        await idDash.expectLoaded();
        userBId = await resolveUserId(idPage);
      } finally {
        await idCtx.close();
      }

      // --- 2. A opens the DM by sending the first message via REST. The
      //        backend auto-creates the dm_channel on first send.
      const helloRes = await pageA.request.post('/api/v1/messages', {
        data: { dmUserId: userBId, body: 'hello' },
      });
      expect(
        helloRes.ok(),
        `A → B initial DM failed: ${helloRes.status()} ${await helloRes.text()}`,
      ).toBe(true);

      // --- 3. B logs in (fresh context), opens /dm/<adminId>, sees `hello`.
      const ctxB1 = await browser.newContext();
      try {
        const pageB1 = await ctxB1.newPage();
        const loginB1 = new LoginPage(pageB1);
        const dashB1 = new DashboardPage(pageB1);
        const dmB1 = new DmChatPage(pageB1);

        await loginB1.goto();
        await loginB1.expectLoaded();
        await loginB1.login(USER_B.email, USER_B.password);
        await dashB1.expectLoaded();

        await dmB1.goto(String(adminId));
        await dmB1.expectLoaded();
        await expect(dmB1.messageByText('hello').last()).toBeVisible({
          timeout: WS_DELIVERY_MS,
        });

        // --- 4. B closes context — simulates WS disconnect.
      } finally {
        await ctxB1.close();
      }

      // --- 5. While B is offline, A posts the offline-era message.
      const offlineBody = `offline-${Date.now()}`;
      const offlineRes = await pageA.request.post('/api/v1/messages', {
        data: { dmUserId: userBId, body: offlineBody },
      });
      expect(
        offlineRes.ok(),
        `A → B offline DM failed: ${offlineRes.status()} ${await offlineRes.text()}`,
      ).toBe(true);

      // --- 6. Brand-new context for B: log in again, open the DM, assert
      //        the offline-era message is present (history or sync.since).
      const ctxB2 = await browser.newContext();
      try {
        const pageB2 = await ctxB2.newPage();
        const loginB2 = new LoginPage(pageB2);
        const dashB2 = new DashboardPage(pageB2);
        const dmB2 = new DmChatPage(pageB2);

        await loginB2.goto();
        await loginB2.expectLoaded();
        await loginB2.login(USER_B.email, USER_B.password);
        await dashB2.expectLoaded();

        await dmB2.goto(String(adminId));
        await dmB2.expectLoaded();

        // Both messages must render — hello (from history) and the offline
        // message (from whichever path the client picks up).
        await expect(dmB2.messageByText('hello').last()).toBeVisible({
          timeout: WS_DELIVERY_MS,
        });
        await expect(dmB2.messageByText(offlineBody).last()).toBeVisible({
          timeout: OFFLINE_SYNC_MS,
        });
      } finally {
        await ctxB2.close();
      }
    } finally {
      await ctxA.close();
    }
  });
});
