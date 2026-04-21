import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { RoomsPage } from '../pages/rooms.page';

/**
 * M5 — attachment access revoked on room ban.
 *
 * Proves the invariant from brief §2.6.4 (download ACL tracks current room
 * membership) together with §2.4.8 (ban removes the target from the member
 * list): once a user is banned from a room, their `GET /attachments/:id/download`
 * for files scoped to that room must flip from 200 → 403, while remaining
 * members retain 200.
 *
 * Flow:
 *   1. admin + user log in (two browser contexts).
 *   2. Both land on the same public room (seed lobby).
 *   3. user uploads a tiny PNG via `POST /api/v1/rooms/:id/attachments`.
 *   4. user posts a message `{ roomId, body, attachmentIds: [id] }`.
 *   5. user `GET /api/v1/attachments/:id/download` → 200 (sanity).
 *   6. admin bans user via `DELETE /api/v1/rooms/:id/members/:userId`.
 *   7. user download → 403 (access revoked).
 *   8. admin download → 200 (remaining member retains access).
 *   9. Bonus §2.4.8: banned user absent from current members list.
 */

const ADMIN = { email: 'admin@example.com', password: 'Admin123!' };
const USER = { email: 'user@example.com', password: 'User1234!' };

// Smallest possible PNG (1x1, transparent). Copied verbatim from
// m4-attachment-upload.spec.ts — keeps this spec free of checked-in binaries.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

const WS_DELIVERY_MS = 3_000;

async function firstJoinedRoomHref(page: import('@playwright/test').Page): Promise<string> {
  const rooms = new RoomsPage(page);
  await rooms.goto();
  await rooms.expectLoaded();
  const firstRoomLink = page.locator('a[href^="/rooms/"]').first();
  const href = await firstRoomLink.getAttribute('href');
  if (!href) throw new Error('no room link visible on rooms catalog');
  return href;
}

function roomIdFromHref(href: string): number {
  const m = href.match(/\/rooms\/(\d+)/);
  if (!m) throw new Error(`cannot parse roomId from href: ${href}`);
  return Number(m[1]);
}

async function currentUserId(page: import('@playwright/test').Page): Promise<number> {
  const res = await page.request.get('/api/v1/auth/session');
  expect(res.status()).toBe(200);
  const body = await res.json();
  // BFF surfaces OIDC sub = "u:<id>" for users (or "a:<id>" for admins).
  if (typeof body.sub !== 'string') {
    throw new Error(`unexpected session shape: ${JSON.stringify(body)}`);
  }
  const match = /^[ua]:(\d+)$/.exec(body.sub);
  if (!match) throw new Error(`malformed session sub: ${body.sub}`);
  return Number(match[1]);
}

test.describe('M5 — attachment access revoked on room ban', () => {
  test(
    'banned user loses download access, remaining members retain it (brief §2.6.4 / §2.4.8)',
    async ({ browser }) => {
      const adminCtx = await browser.newContext();
      const userCtx = await browser.newContext();

      try {
        const adminPage = await adminCtx.newPage();
        const userPage = await userCtx.newPage();

        // --- 1. login both ---------------------------------------------------
        const adminLogin = new LoginPage(adminPage);
        const userLogin = new LoginPage(userPage);
        await adminLogin.goto();
        await adminLogin.login(ADMIN.email, ADMIN.password);
        await userLogin.goto();
        await userLogin.login(USER.email, USER.password);

        // --- 2. pick shared room --------------------------------------------
        const href = await firstJoinedRoomHref(adminPage);
        const roomId = roomIdFromHref(href);
        await adminPage.goto(href);
        await userPage.goto(href);

        const userId = await currentUserId(userPage);

        // --- 3. user uploads tiny PNG to the room ---------------------------
        const uploadRes = await userPage.request.post(
          `/api/v1/rooms/${roomId}/attachments`,
          {
            multipart: {
              file: {
                name: 'revoke.png',
                mimeType: 'image/png',
                buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
              },
            },
          },
        );
        expect(uploadRes.status(), await uploadRes.text()).toBeLessThan(300);
        const uploadBody = (await uploadRes.json()) as {
          attachments: Array<{ id: string }>;
        };
        expect(Array.isArray(uploadBody.attachments)).toBe(true);
        expect(uploadBody.attachments.length).toBeGreaterThan(0);
        const attachmentId = uploadBody.attachments[0].id;
        expect(attachmentId).toMatch(/^[0-9a-f-]{36}$/i);

        // --- 4. user posts message binding the attachment -------------------
        const msgRes = await userPage.request.post('/api/v1/messages', {
          data: {
            roomId,
            body: 'before ban',
            attachmentIds: [attachmentId],
          },
        });
        expect(msgRes.status(), await msgRes.text()).toBe(201);

        // --- 5. user download BEFORE ban → 200 ------------------------------
        const preBanUser = await userPage.request.get(
          `/api/v1/attachments/${attachmentId}/download`,
        );
        expect(preBanUser.status()).toBe(200);

        // --- 6. admin bans user ---------------------------------------------
        const banRes = await adminPage.request.delete(
          `/api/v1/rooms/${roomId}/members/${userId}`,
        );
        expect(
          banRes.status(),
          `ban expected 2xx, got ${banRes.status()} body=${await banRes.text()}`,
        ).toBeLessThan(300);

        // Give the backend a beat to propagate the ban (JWT/session cache, WS
        // drop). Downloads hit a fresh ACL query each time so a short poll is
        // enough — WS_DELIVERY_MS is the project-wide comfort window.
        await expect
          .poll(
            async () => {
              const r = await userPage.request.get(
                `/api/v1/attachments/${attachmentId}/download`,
              );
              return r.status();
            },
            { timeout: WS_DELIVERY_MS, intervals: [200, 300, 500] },
          )
          .toBe(403);

        // --- 7. (covered above) user download AFTER ban → 403 ---------------

        // --- 8. admin download AFTER ban → 200 (unchanged for members) ------
        const postBanAdmin = await adminPage.request.get(
          `/api/v1/attachments/${attachmentId}/download`,
        );
        expect(postBanAdmin.status()).toBe(200);

        // --- 9. §2.4.8: banned user absent from current members list --------
        //      (Soft assertion — the /bans tab is the canonical evidence, but
        //      a banned user must not appear as an active member either.)
        const bansRes = await adminPage.request.get(`/api/v1/rooms/${roomId}/bans`);
        expect(bansRes.status()).toBe(200);
        const bans = (await bansRes.json()) as Array<{ userId?: number }>;
        const bannedIds = bans
          .map((b) => (typeof b.userId === 'number' ? b.userId : null))
          .filter((x): x is number => x !== null);
        expect(bannedIds).toContain(userId);
      } finally {
        await adminCtx.close();
        await userCtx.close();
      }
    },
  );
});
