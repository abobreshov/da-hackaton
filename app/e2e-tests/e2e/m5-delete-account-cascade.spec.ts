import { test, expect, request as apiRequest } from '@playwright/test';

/**
 * M5 — DELETE /auth/account cascades a user's rooms + messages + DM history
 * via the `user-cascade-delete` BullMQ job (ADR-002, spec §2.1.5).
 *
 * Flow:
 *   1. Register a fresh user against the BFF (POST /auth/register → 202).
 *   2. Harvest the verification token from Mailpit and hit verify-email to
 *      mint the session cookie (auto-login on successful verification).
 *   3. User creates a public room and posts a message there.
 *   4. Admin signs in on a second context to observe the cascade.
 *   5. User calls DELETE /auth/account — expect 204, session cookie cleared.
 *   6. Poll admin-side room catalog until the user's room is gone.
 *   7. Poll admin-side GET /users/:id until it 404s.
 *
 * BullMQ runs async; both cascade checks use `expect.poll(...).toPass(...)`
 * bounded by `CASCADE_POLL_MS`.
 */

const ADMIN = { email: 'admin@example.com', password: 'Admin123!' };
const MAILPIT_BASE = process.env.MAILPIT_URL ?? 'http://localhost:8025';

const WS_DELIVERY_MS = 3_000;
const CASCADE_POLL_MS = 15_000;

type Awaited<T> = T extends Promise<infer U> ? U : T;
type APIRequestContext = Awaited<ReturnType<typeof apiRequest.newContext>>;

/**
 * Mailpit stores messages oldest-first in the `messages` array. Filter by
 * recipient and pick the newest — the verification email is always the last
 * one delivered to that address in a freshly-registered flow.
 */
async function fetchVerifyTokenFromMailpit(email: string): Promise<string> {
  const mp = await apiRequest.newContext({ baseURL: MAILPIT_BASE });
  try {
    const tokenRegex = /verify-email\?token=([a-f0-9]{64})/i;
    let token: string | null = null;
    await expect
      .poll(
        async () => {
          const res = await mp.get(`/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
          if (!res.ok()) return null;
          const body = (await res.json()) as { messages?: Array<{ ID: string }> };
          const msgs = body.messages ?? [];
          for (const m of msgs) {
            const full = await mp.get(`/api/v1/message/${m.ID}`);
            if (!full.ok()) continue;
            const detail = (await full.json()) as { HTML?: string; Text?: string };
            const haystack = `${detail.HTML ?? ''}\n${detail.Text ?? ''}`;
            const match = haystack.match(tokenRegex);
            if (match) {
              token = match[1];
              return token;
            }
          }
          return null;
        },
        { timeout: WS_DELIVERY_MS * 3, message: `no verify email for ${email}` },
      )
      .not.toBeNull();
    if (!token) throw new Error('unreachable');
    return token;
  } finally {
    await mp.dispose();
  }
}

test.describe('M5 — DELETE /auth/account cascade (spec §2.1.5 / ADR-002)', () => {
  test('user self-deletes; BullMQ cascade removes rooms + messages + user record', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(60_000);

    const ts = Date.now();
    const email = `cascade-${ts}@example.com`;
    const username = `cascade_${ts}`;
    const password = 'Cascade123!Xy';
    const roomName = `cascade-room-${ts}`;

    const userCtx = await browser.newContext();
    const adminCtx = await browser.newContext();

    try {
      const userPage = await userCtx.newPage();
      const adminPage = await adminCtx.newPage();

      // --- 1) Register fresh user via BFF --------------------------------------
      const registerRes = await userPage.request.post('/api/v1/auth/register', {
        data: { email, username, password },
      });
      expect(registerRes.status(), 'register returns 202').toBe(202);

      // --- 2) Fetch verification token + verify-email (auto-login) -------------
      const verifyToken = await fetchVerifyTokenFromMailpit(email);
      const verifyRes = await userPage.request.post('/api/v1/auth/verify-email', {
        data: { token: verifyToken },
      });
      expect(verifyRes.status(), 'verify-email returns 2xx').toBeLessThan(300);

      // Session cookie should now be set on the user context.
      const sessionRes = await userPage.request.get('/api/v1/auth/session');
      expect(sessionRes.status()).toBe(200);
      const sessionBody = (await sessionRes.json()) as { userId: number; email: string };
      expect(sessionBody.email).toBe(email);
      const freshUserId = sessionBody.userId;
      expect(typeof freshUserId).toBe('number');

      // --- 3) User creates a public room --------------------------------------
      const createRoomRes = await userPage.request.post('/api/v1/rooms', {
        data: { name: roomName, visibility: 'public' },
      });
      expect(createRoomRes.status(), 'create room returns 201').toBe(201);
      const createdRoom = (await createRoomRes.json()) as { id: number; name: string };
      expect(createdRoom.name).toBe(roomName);

      // --- 4) User sends one message into that room ---------------------------
      const sendRes = await userPage.request.post('/api/v1/messages', {
        data: { roomId: createdRoom.id, body: 'hello before delete' },
      });
      expect(sendRes.status(), 'send message returns 201').toBe(201);

      // --- 5) Admin signs in on a second context to observe cascade -----------
      const adminLoginRes = await adminPage.request.post('/api/v1/auth/login', {
        data: { email: ADMIN.email, password: ADMIN.password, type: 'admin' },
      });
      expect(adminLoginRes.status(), 'admin login returns 2xx').toBeLessThan(300);

      // Sanity: admin catalog currently sees the user's room.
      const preCatalogRes = await adminPage.request.get('/api/v1/rooms/catalog');
      expect(preCatalogRes.status()).toBe(200);
      const preCatalog = (await preCatalogRes.json()) as Array<{ name: string }>;
      expect(preCatalog.some((r) => r.name === roomName)).toBe(true);

      // --- 6) User deletes own account ----------------------------------------
      const deleteRes = await userPage.request.delete('/api/v1/auth/account');
      expect(deleteRes.status(), 'DELETE /auth/account returns 204').toBe(204);

      // Session cookie should be cleared — follow-up session call is 401.
      const afterSessionRes = await userPage.request.get('/api/v1/auth/session');
      expect(afterSessionRes.status(), 'session 401 after self-delete').toBe(401);

      const userCookies = await userCtx.cookies(baseURL ?? 'http://localhost:3007');
      const liveSession = userCookies.find((c) => c.name === 'session' && c.value.length > 0);
      expect(liveSession, 'session cookie cleared after self-delete').toBeUndefined();

      // --- 7) Poll admin catalog — cascade-room-<ts> disappears ---------------
      await expect
        .poll(
          async () => {
            const res = await adminPage.request.get('/api/v1/rooms/catalog');
            if (!res.ok()) return 'http-error';
            const rooms = (await res.json()) as Array<{ name: string }>;
            return rooms.some((r) => r.name === roomName) ? 'still-present' : 'gone';
          },
          {
            timeout: CASCADE_POLL_MS,
            message: `room "${roomName}" should be cascade-deleted from catalog`,
          },
        )
        .toBe('gone');

      // --- 8) Poll admin users lookup — GET /users/:id flips to 404 -----------
      await expect
        .poll(
          async () => {
            const res = await adminPage.request.get(`/api/v1/users/${freshUserId}`);
            return res.status();
          },
          {
            timeout: CASCADE_POLL_MS,
            message: `GET /users/${freshUserId} should 404 after cascade`,
          },
        )
        .toBe(404);
    } finally {
      await userCtx.close();
      await adminCtx.close();
    }
  });
});
