import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3007';
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './e2e',
  globalSetup: resolve(__dirname, './global-setup.ts'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 45_000,
  // WS-dependent surfaces (room detail members, chat composer, DM list) need
  // a handshake + room.join ack before they render. 10s keeps the budget
  // friendly for selector drift while avoiding flakes on slow boot.
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
