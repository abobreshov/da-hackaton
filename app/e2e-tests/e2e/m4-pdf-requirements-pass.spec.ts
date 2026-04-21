import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RegisterPage } from '../pages/register.page';
import { RoomsPage } from '../pages/rooms.page';
import { RoomChatPage } from '../pages/room-chat.page';

/**
 * M4 — PDF requirements happy-path smoke (T27).
 *
 * Walks the user-facing journey called out by the hackathon brief
 * (`mng/requirements/requirements.md` §2): registration, sign-in, rooms
 * catalog, opening a room, posting a message. Each scenario isolates its
 * own browser context so cookies from earlier tests do not leak.
 *
 * Seed (see `src/auth-service/scripts/seed.ts`):
 *   user@example.com / User1234!
 */

const SEED_USER = { email: 'user@example.com', password: 'User1234!' };

function uniqueSuffix(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}${rand}`;
}

test.describe('M4 — PDF requirements happy path', () => {
  test('anonymous visitor on / is redirected to /login', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.goto('/');
      await page.waitForURL(/\/login$/);
      const login = new LoginPage(page);
      await login.expectLoaded();
    } finally {
      await ctx.close();
    }
  });

  test('new user can register and lands on /dashboard', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      const register = new RegisterPage(page);
      const dashboard = new DashboardPage(page);

      await register.goto();
      await register.expectLoaded();

      const suffix = uniqueSuffix();
      await register.fillForm(`pdf_${suffix}@example.com`, `pdf_${suffix}`, 'PdfPass-1!');
      await register.submit();

      await register.expectDashboardRedirect();
      await dashboard.expectLoaded();
    } finally {
      await ctx.close();
    }
  });

  test('seeded user signs in with email + password and lands on /dashboard', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      const login = new LoginPage(page);
      const dashboard = new DashboardPage(page);

      await login.goto();
      await login.expectLoaded();
      await login.login(SEED_USER.email, SEED_USER.password);

      await dashboard.expectLoaded();
    } finally {
      await ctx.close();
    }
  });

  test('user browses /rooms catalog and sees at least one public room', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      const login = new LoginPage(page);
      const rooms = new RoomsPage(page);

      await login.goto();
      await login.login(SEED_USER.email, SEED_USER.password);

      await rooms.goto();
      await rooms.expectLoaded();

      // Seed wires the demo lobby — at least one room link must render.
      const firstRoom = page.locator('a[href^="/rooms/"]').first();
      await expect(firstRoom).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('user opens a room and the chat composer is visible', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      const login = new LoginPage(page);
      const rooms = new RoomsPage(page);

      await login.goto();
      await login.login(SEED_USER.email, SEED_USER.password);

      await rooms.goto();
      await rooms.expectLoaded();

      const firstRoom = page.locator('a[href^="/rooms/"]').first();
      const href = await firstRoom.getAttribute('href');
      if (!href) throw new Error('no room link visible on rooms catalog');
      await page.goto(href);

      const chat = new RoomChatPage(page);
      await expect(chat.composerInput).toBeVisible();
      await expect(chat.messageList).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('user types and sends a message and their bubble appears in the viewport', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      const login = new LoginPage(page);
      const rooms = new RoomsPage(page);

      await login.goto();
      await login.login(SEED_USER.email, SEED_USER.password);

      await rooms.goto();
      await rooms.expectLoaded();

      const firstRoom = page.locator('a[href^="/rooms/"]').first();
      const href = await firstRoom.getAttribute('href');
      if (!href) throw new Error('no room link visible on rooms catalog');
      await page.goto(href);

      const chat = new RoomChatPage(page);
      await expect(chat.composerInput).toBeVisible();

      const body = `pdf-smoke ${uniqueSuffix()}`;
      await chat.typeAndSend(body);

      await chat.expectMessageVisible(body);
    } finally {
      await ctx.close();
    }
  });
});
