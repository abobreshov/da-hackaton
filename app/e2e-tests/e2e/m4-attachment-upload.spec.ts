import path from 'node:path';
import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { RoomsPage } from '../pages/rooms.page';
import { RoomChatPage } from '../pages/room-chat.page';

/**
 * M4 — EPIC-08 attachment upload round-trip.
 *
 * Seed covers admin + user joined into the demo lobby. Both browsers open
 * the same room; admin uploads a small image, sends an empty-body message
 * (attachment-only), user sees the inline image in their viewport.
 *
 * The fixture file is created on the fly as a tiny PNG so the spec has no
 * checked-in binary assets. 3 MiB image cap is NOT exercised here — the
 * uploader unit test covers that.
 */

const ADMIN = { email: 'admin@example.com', password: 'Admin123!' };
const USER = { email: 'user@example.com', password: 'User1234!' };

// Smallest possible PNG (1x1, transparent) — decoded from a constant.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

const WS_DELIVERY_MS = 3_000;

async function firstJoinedRoomHref(page: import('@playwright/test').Page): Promise<string> {
  const rooms = new RoomsPage(page);
  await rooms.goto();
  await rooms.expectLoaded();
  // The rooms catalog renders public rooms; seed provides at least one.
  const firstRoomLink = page.locator('a[href^="/rooms/"]').first();
  const href = await firstRoomLink.getAttribute('href');
  if (!href) throw new Error('no room link visible on rooms catalog');
  return href;
}

test.describe('M4 — attachment upload round-trip', () => {
  test('admin uploads image to room, user sees it inline', async ({ browser }, testInfo) => {
    const adminCtx = await browser.newContext();
    const userCtx = await browser.newContext();

    const tmpFile = testInfo.outputPath('hello.png');
    const fs = await import('node:fs/promises');
    await fs.writeFile(tmpFile, Buffer.from(TINY_PNG_BASE64, 'base64'));

    try {
      const adminPage = await adminCtx.newPage();
      const userPage = await userCtx.newPage();

      // Both log in.
      const adminLogin = new LoginPage(adminPage);
      const userLogin = new LoginPage(userPage);
      await adminLogin.goto();
      await adminLogin.login(ADMIN.email, ADMIN.password);
      await userLogin.goto();
      await userLogin.login(USER.email, USER.password);

      // Both navigate to the same room.
      const href = await firstJoinedRoomHref(adminPage);
      await adminPage.goto(href);
      await userPage.goto(href);

      const adminChat = new RoomChatPage(adminPage);
      const userChat = new RoomChatPage(userPage);
      await expect(adminChat.composerInput).toBeVisible();
      await expect(userChat.messageList).toBeVisible();

      // Upload a file via the hidden input. Playwright exposes setInputFiles
      // directly — no need to click the visible "+ Attach" button.
      const input = adminPage.getByTestId('attachment-uploader-input');
      await input.setInputFiles(tmpFile);

      // Chip strip should render with the filename.
      const strip = adminPage.getByTestId('attachment-uploader-strip');
      await expect(strip).toBeVisible();
      await expect(strip).toContainText(/hello\.png/);

      // Empty body + send: composer must allow send-with-attachment.
      await adminChat.composerSend.click();

      // Both sides now have a message with an inline image.
      await expect(
        adminChat.messageList.getByTestId(/^attachment-image-/).first(),
      ).toBeVisible({ timeout: WS_DELIVERY_MS });
      await expect(
        userChat.messageList.getByTestId(/^attachment-image-/).first(),
      ).toBeVisible({ timeout: WS_DELIVERY_MS });

      // Image href points at the download endpoint.
      const peerImg = userChat.messageList.getByTestId(/^attachment-image-/).first();
      const a = peerImg.locator('a').first();
      await expect(a).toHaveAttribute('href', /\/api\/v1\/attachments\/[\w-]+\/download$/);
    } finally {
      await adminCtx.close();
      await userCtx.close();
    }
  });

  test('removing a pending attachment before send clears the chip', async ({ browser }, testInfo) => {
    const adminCtx = await browser.newContext();
    const tmpFile = testInfo.outputPath('hello.png');
    const fs = await import('node:fs/promises');
    await fs.writeFile(tmpFile, Buffer.from(TINY_PNG_BASE64, 'base64'));

    try {
      const adminPage = await adminCtx.newPage();
      const adminLogin = new LoginPage(adminPage);
      await adminLogin.goto();
      await adminLogin.login(ADMIN.email, ADMIN.password);

      const href = await firstJoinedRoomHref(adminPage);
      await adminPage.goto(href);

      const adminChat = new RoomChatPage(adminPage);
      await expect(adminChat.composerInput).toBeVisible();

      await adminPage.getByTestId('attachment-uploader-input').setInputFiles(tmpFile);
      const strip = adminPage.getByTestId('attachment-uploader-strip');
      await expect(strip).toBeVisible();

      // Chip carries a remove button with an accessible label.
      const removeBtn = adminPage.locator('[data-testid^="attachment-chip-remove-"]').first();
      await removeBtn.click();

      // Strip disappears (no chips left).
      await expect(strip).not.toBeVisible();

      // Send button is disabled again (empty body + no attachments).
      await expect(adminChat.composerSend).toBeDisabled();
    } finally {
      await adminCtx.close();
    }
  });
});
