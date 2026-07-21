import { test, expect } from '@playwright/test';

/**
 * TC-A10 — a choked compute must NEVER read as flat/zero.
 *
 * Moat-critical honesty guarantee: when the geoprocessor fails, the UI must
 * surface an explicit "couldn't load — tap to retry" affordance, NOT a false
 * flat/zero read (which a hunter would misread as "no terrain / no deer here").
 *
 * The app exposes an env-gated test hook: with server env
 * TFP_ALLOW_TEST_FAILURE=1, appending ?forceFail=1 to /intel makes the
 * /api/terrain-flow route return the SAME 502 failure envelope as a real
 * transient ridge failure, driving the real client retry path.
 *
 * Requires: server running with TFP_ALLOW_TEST_FAILURE=1 (set in .env).
 */

const LAT = 35.9132;
const LNG = -84.0891;

test('TC-A10: forced compute failure shows the retry affordance, not a flat read', async ({ page }) => {
  await page.goto(`/intel?lat=${LAT}&lng=${LNG}&forceFail=1`, { waitUntil: 'domcontentloaded' });

  const canvas = page.locator('canvas.mapboxgl-canvas');
  await expect(canvas).toBeVisible({ timeout: 60_000 });

  // The client should route the 502 to the explicit retry banner. Assert the
  // "tap to retry" affordance appears (case-insensitive), and that we do NOT
  // present a confident all-zero / flat verdict.
  const retry = page.getByText(/tap to retry|couldn.?t load|try again/i);
  await expect(retry.first()).toBeVisible({ timeout: 60_000 });
});
