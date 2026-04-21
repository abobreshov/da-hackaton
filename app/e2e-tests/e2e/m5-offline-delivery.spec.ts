import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RegisterPage } from '../pages/register.page';
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
 * Scenario:
 *   1. User B registers fresh (timestamp-suffixed email) and captures their
 *      numeric id via GET /api/v1/auth/session. Context B then closes so no
 *      live WS remains for the first A→B message beyond the initial sync.
 *   2. User A (seeded user@example.com) logs in, opens a DM to B by POSTing
 *      an initial `hello` message through /api/v1/messages { dmUserId, body } —
 *      which auto-creates the dm_channel — then stays connected.
 *   3. Context B re-opens, B logs in, navigates to /dm/<A.id>, and the
 *      history fetch surfaces the `hello` bubble (baseline).
 *   4. Context B closes: simulates the recipient going offline.
 *   5. User A (still connected) posts a second message
 *      `offline-<ts>` via /api/v1/messages while B has no WS.
 *   6. A brand-new context B logs in again and opens the DM. The offline
 *      message must appear — whether via history or sync.since is immaterial,
 *      both satisfy EPIC-03.
 *
 * Constants intentionally shadow the sibling m3-dm-flow spec's timings.
 */

const USER_A = { email: 'user@example.com', password: 'User1234!' };

const WS_DELIVERY_MS = 3_000;
const OFFLINE_SYNC_MS = 5_000;

function uniqueSuffix(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}${rand}`;
}

test.describe('M5 — offline DM delivery', () => {
  test('message sent while recipient WS is disconnected renders on reconnect (brief §2.5.6, EPIC-03)', async ({
    browser,
  }) => {
    const suffix = uniqueSuffix();
    const userB = {
      email: `offline-b-${suffix}@example.com`,
      username: `offline_b_${suffix}`,
      password: 'Offline-B-42!',
    };

    // --- 1. Register user B to seize their numeric id, then tear the
    //        context down so the subsequent A→B send happens with no live
    //        B-side WS for the first message window.
    const bootstrapCtx = await browser.newContext();
    let userBId: number;
    try {
      const bootstrapPage = await bootstrapCtx.newPage();
      const registerPage = new RegisterPage(bootstrapPage);
      const dashboardPage = new DashboardPage(bootstrapPage);

      await registerPage.goto();
      await registerPage.expectLoaded();
      await registerPage.fillForm(userB.email, userB.username, userB.password);
      await registerPage.submit();
      await registerPage.expectDashboardRedirect();
      await dashboardPage.expectLoaded();

      const sessionRes = await bootstrapPage.request.get('/api/v1/auth/session');
      expect(sessionRes.ok(), `session fetch for B failed: ${sessionRes.status()}`).toBe(true);
      const sessionBody = await sessionRes.json();
      // BFF surfaces OIDC sub = "u:<id>" — no flat userId field.
      const bMatch = String(sessionBody.sub ?? '').match(/^u:(\d+)$/);
      expect(bMatch, `B session sub malformed: ${sessionBody.sub}`).not.toBeNull();
      userBId = Number(bMatch![1]);
    } finally {
      await bootstrapCtx.close();
    }

    // --- 2. User A logs in, opens the DM by sending the first message
    //        via /api/v1/messages. The backend auto-creates the dm_channel.
    const ctxA = await browser.newContext();
    let userAId: number;
    try {
      const pageA = await ctxA.newPage();
      const loginA = new LoginPage(pageA);
      const dashA = new DashboardPage(pageA);
      const dmA = new DmChatPage(pageA);

      await loginA.goto();
      await loginA.expectLoaded();
      await loginA.login(USER_A.email, USER_A.password);
      await dashA.expectLoaded();

      const sessionA = await pageA.request.get('/api/v1/auth/session');
      expect(sessionA.ok()).toBe(true);
      const sessionABody = await sessionA.json();
      const aMatch = String(sessionABody.sub ?? '').match(/^u:(\d+)$/);
      expect(aMatch, `A session sub malformed: ${sessionABody.sub}`).not.toBeNull();
      userAId = Number(aMatch![1]);

      const helloRes = await pageA.request.post('/api/v1/messages', {
        data: { dmUserId: userBId, body: 'hello' },
      });
      expect(
        helloRes.ok(),
        `A → B initial DM failed: ${helloRes.status()} ${await helloRes.text()}`,
      ).toBe(true);

      // --- 3. B logs in (fresh context), navigates to /dm/<A.id>, and the
      //        history fetch yields the `hello` bubble.
      const ctxB1 = await browser.newContext();
      try {
        const pageB1 = await ctxB1.newPage();
        const loginB1 = new LoginPage(pageB1);
        const dashB1 = new DashboardPage(pageB1);
        const dmB1 = new DmChatPage(pageB1);

        await loginB1.goto();
        await loginB1.expectLoaded();
        await loginB1.login(userB.email, userB.password);
        await dashB1.expectLoaded();

        await dmB1.goto(String(userAId));
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
        await loginB2.login(userB.email, userB.password);
        await dashB2.expectLoaded();

        await dmB2.goto(String(userAId));
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
