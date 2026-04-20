import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { RegisterPage } from '../pages/register.page';
import { RoomsPage } from '../pages/rooms.page';
import { RoomDetailPage } from '../pages/room-detail.page';
import { ContactsPage } from '../pages/contacts.page';

type Pages = {
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  registerPage: RegisterPage;
  roomsPage: RoomsPage;
  roomDetailPage: RoomDetailPage;
  contactsPage: ContactsPage;
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
});

export { expect } from '@playwright/test';
