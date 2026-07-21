import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the TFP weekly system-test suite (browser-level E2E).
 *
 * This is SEPARATE from the vitest unit/integration suite in __tests__/ (which
 * runs with `yarn test`). Playwright drives a real browser so it can exercise
 * gestures the jsdom/vitest harness cannot — notably the Hunt Zone ring drag
 * (TC-A3), which is a WebGL Mapbox layer with no DOM node, and the forced
 * compute-failure retry path (TC-A10).
 *
 * One-time setup (not installed by default to keep the app build light):
 *   yarn add -D @playwright/test
 *   npx playwright install chromium
 *
 * Run against a running server (dev on :3000 or a deployed URL):
 *   PW_BASE_URL=http://localhost:3000 npx playwright test
 *   PW_BASE_URL=https://terra-firma-mapping-nf30ep.abacusai.app npx playwright test
 *
 * TC-A10 additionally requires the server env TFP_ALLOW_TEST_FAILURE=1 so the
 * ?forceFail=1 hook is honored (already set in .env for staging).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PW_BASE_URL || 'http://localhost:3000',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
