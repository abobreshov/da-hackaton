import { test as base } from '@playwright/test';
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
};

export const test = base.extend<Pages>({
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
