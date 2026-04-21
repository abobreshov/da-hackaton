import { test as base } from '@playwright/test';
import IORedis from 'ioredis';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RegisterPage } from '../pages/register.page';
import { RoomsPage } from '../pages/rooms.page';
import { RoomDetailPage } from '../pages/room-detail.page';
import { ContactsPage } from '../pages/contacts.page';
import { RoomChatPage } from '../pages/room-chat.page';
import { DmChatPage } from '../pages/dm-chat.page';
import { AdminPage } from '../pages/admin.page';

type Pages = {
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  registerPage: RegisterPage;
  roomsPage: RoomsPage;
  roomDetailPage: RoomDetailPage;
  contactsPage: ContactsPage;
  roomChatPage: RoomChatPage;
  dmChatPage: DmChatPage;
  adminPage: AdminPage;
  clearRateLimits: void;
};

// One shared redis handle per worker so we don't reconnect per test.
let __redis: IORedis | null = null;
function redisClient(): IORedis {
  if (__redis) return __redis;
  __redis = new IORedis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6380),
    lazyConnect: false,
    maxRetriesPerRequest: 2,
  });
  __redis.on('error', () => {
    /* swallow — global-setup already warned */
  });
  return __redis;
}

export const test = base.extend<Pages>({
  // Auto-fixture: drain `ratelimit:*` before every test so the BFF throttle
  // buckets (5/15min per email) don't cross-contaminate the run.
  clearRateLimits: [
    async ({}, use) => {
      try {
        const r = redisClient();
        const stream = r.scanStream({ match: 'ratelimit:*', count: 500 });
        const pending: Promise<number>[] = [];
        for await (const keys of stream) {
          if (keys.length > 0) pending.push(r.del(...keys));
        }
        await Promise.all(pending);
      } catch {
        /* best-effort */
      }
      await use();
    },
    { auto: true },
  ],
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
  registerPage: async ({ page }, use) => {
    await use(new RegisterPage(page));
  },
  roomsPage: async ({ page }, use) => {
    await use(new RoomsPage(page));
  },
  roomDetailPage: async ({ page }, use) => {
    await use(new RoomDetailPage(page));
  },
  contactsPage: async ({ page }, use) => {
    await use(new ContactsPage(page));
  },
  roomChatPage: async ({ page }, use) => {
    await use(new RoomChatPage(page));
  },
  dmChatPage: async ({ page }, use) => {
    await use(new DmChatPage(page));
  },
  adminPage: async ({ page }, use) => {
    await use(new AdminPage(page));
  },
});

export { expect } from '@playwright/test';
