import { test, expect } from '../fixtures/test';

/**
 * M5 — Room lifecycle end-to-end (EPIC-05).
 *
 * Covers the full create → discover → join → post → delete → cascade
 * journey across two authenticated browser contexts.
 *
 * Exercises:
 *   - AC-05-01 authenticated user creates a public room
 *   - AC-05-02 catalog lists newly created public rooms
 *   - AC-05-03 second user joins via catalog
 *   - AC-05-04 joined room shows in /rooms/my
 *   - AC-05-07 owner deletes room
 *   - AC-05-08 cascade: messages removed, non-owner sees 403/404,
 *     owner sees 404 after delete, room gone from catalog
 */

const ADMIN = { email: 'admin@example.com', password: 'Admin123!' };
const USER = { email: 'user@example.com', password: 'User1234!' };

const WS_DELIVERY_MS = 3_000;

test.describe('M5 — room create/delete lifecycle', () => {
  test('AC-05-01/02/03/04/07/08 — admin creates, user joins, admin deletes, cascade enforced', async ({
    browser,
  }) => {
    const adminCtx = await browser.newContext();
    const userCtx = await browser.newContext();

    try {
      const adminPage = await adminCtx.newPage();
      const userPage = await userCtx.newPage();

      // --- Arrange: both users reach the app and establish BFF sessions
      // by performing the UI login flow. page.request inherits the context
      // cookies afterwards so direct API calls are authenticated.
      await adminPage.goto('/login');
      await adminPage.getByLabel(/email/i).fill(ADMIN.email);
      await adminPage.getByLabel(/password/i).fill(ADMIN.password);
      // Login submit copy: "Let's Go" (idle) / "Signing you in…" (busy).
      await adminPage.getByRole('button', { name: /let's go|signing you in/i }).click();
      await adminPage.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: WS_DELIVERY_MS * 2,
      });

      await userPage.goto('/login');
      await userPage.getByLabel(/email/i).fill(USER.email);
      await userPage.getByLabel(/password/i).fill(USER.password);
      await userPage.getByRole('button', { name: /let's go|signing you in/i }).click();
      await userPage.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: WS_DELIVERY_MS * 2,
      });

      const ts = Date.now();
      const roomName = `lifecycle-${ts}`;

      // --- AC-05-01: admin creates a public room via POST /api/v1/rooms.
      const createRes = await adminPage.request.post('/api/v1/rooms', {
        data: {
          name: roomName,
          description: 'E2E test room',
          visibility: 'public',
        },
      });
      expect(createRes.ok(), `create room failed: ${createRes.status()}`).toBe(true);
      const created = await createRes.json();
      const roomId: string = created.id ?? created.roomId ?? created.data?.id;
      expect(roomId, 'roomId present in create response').toBeTruthy();

      // --- AC-05-02: GET /api/v1/rooms/catalog lists the new room.
      await expect(async () => {
        const catalogRes = await adminPage.request.get('/api/v1/rooms/catalog');
        expect(catalogRes.ok()).toBe(true);
        const catalog = await catalogRes.json();
        const rooms: Array<{ id: string; name: string }> = Array.isArray(catalog)
          ? catalog
          : (catalog.rooms ?? catalog.data ?? []);
        expect(rooms.some((r) => r.id === roomId || r.name === roomName)).toBe(true);
      }).toPass({ timeout: WS_DELIVERY_MS });

      // --- AC-05-03: second user joins via POST /api/v1/rooms/:id/join.
      const joinRes = await userPage.request.post(`/api/v1/rooms/${roomId}/join`);
      expect(joinRes.ok(), `join failed: ${joinRes.status()}`).toBe(true);

      // --- AC-05-04: GET /api/v1/rooms/my for user shows the new room.
      await expect(async () => {
        const myRes = await userPage.request.get('/api/v1/rooms/my');
        expect(myRes.ok()).toBe(true);
        const my = await myRes.json();
        const rooms: Array<{ id: string; name: string }> = Array.isArray(my)
          ? my
          : (my.rooms ?? my.data ?? []);
        expect(rooms.some((r) => r.id === roomId || r.name === roomName)).toBe(true);
      }).toPass({ timeout: WS_DELIVERY_MS });

      // --- Admin posts a message so cascade can be observed.
      const msgRes = await adminPage.request.post('/api/v1/messages', {
        data: { roomId, body: 'before-delete' },
      });
      expect(msgRes.ok(), `post message failed: ${msgRes.status()}`).toBe(true);

      // --- AC-05-07: owner deletes the room.
      const deleteRes = await adminPage.request.delete(`/api/v1/rooms/${roomId}`);
      expect([200, 202, 204]).toContain(deleteRes.status());

      // --- AC-05-08a: catalog no longer lists the room.
      await expect(async () => {
        const catalogRes = await adminPage.request.get('/api/v1/rooms/catalog');
        expect(catalogRes.ok()).toBe(true);
        const catalog = await catalogRes.json();
        const rooms: Array<{ id: string; name: string }> = Array.isArray(catalog)
          ? catalog
          : (catalog.rooms ?? catalog.data ?? []);
        expect(rooms.some((r) => r.id === roomId)).toBe(false);
      }).toPass({ timeout: WS_DELIVERY_MS });

      // --- AC-05-08b: non-owner fetching messages gets 403 or 404.
      const userMsgRes = await userPage.request.get(`/api/v1/rooms/${roomId}/messages`);
      expect([403, 404]).toContain(userMsgRes.status());

      // --- AC-05-08c: owner fetching messages gets 404 (room gone).
      const adminMsgRes = await adminPage.request.get(`/api/v1/rooms/${roomId}/messages`);
      expect(adminMsgRes.status()).toBe(404);
    } finally {
      await userCtx.close();
      await adminCtx.close();
    }
  });
});
