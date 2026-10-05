import { existsSync, readFileSync } from 'fs';
import { defineConfig, devices } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4321';

// Local runs create many leads; with a real RESEND_API_KEY present they must never deliver email.
if (!process.env.BASE_URL) {
  for (const f of ['.dev.vars', 'dist/server/.dev.vars']) {
    if (existsSync(f) && !/^\s*EMAIL_MODE\s*=\s*["']?(log|fail)["']?\s*$/m.test(readFileSync(f, 'utf8'))) {
      throw new Error(`${f} must set EMAIL_MODE=log (or fail) for local test runs.`);
    }
  }
}

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'desktop-1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'tablet-1024', use: { ...devices['iPad Pro 11'], browserName: 'chromium', viewport: { width: 1024, height: 1366 } } },
    { name: 'mobile-430', use: { ...devices['iPhone 15 Pro Max'], browserName: 'chromium', viewport: { width: 430, height: 932 } } },
    { name: 'mobile-390', use: { ...devices['iPhone 14'], browserName: 'chromium', viewport: { width: 390, height: 844 } } },
    { name: 'phone-landscape', use: { ...devices['iPhone 14 landscape'], browserName: 'chromium', viewport: { width: 844, height: 390 } } },
    { name: 'tablet-portrait', use: { ...devices['iPad Pro 11'], browserName: 'chromium', viewport: { width: 820, height: 1180 } } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
  // Local runs always use a test-mode build (Cloudflare testing keys); BASE_URL targets a deployed environment.
  webServer: process.env.BASE_URL
    ? undefined
    : { command: 'npm run build:test && npx astro preview --port 4321 --host 127.0.0.1', url: BASE, reuseExistingServer: true, timeout: 300_000 },
});
