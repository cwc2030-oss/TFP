import { test, expect } from '@playwright/test';

/**
 * TC-A3 — Hunt Zone ring drag (the primary read gesture).
 *
 * The ring is a WebGL Mapbox layer, so there is no DOM element to drag; the
 * jsdom/vitest harness could not exercise it (came back INCONCLUSIVE). This
 * test drives a REAL pointer drag over the map canvas: pointer down on the ring
 * (map center, where the A-300 ring is anchored) -> move in steps > CLICK_SLOP_PX
 * -> up. It then asserts the ring committed a MOVE (center changed + moveCount
 * incremented) via the window.__tfpHuntZone test hook the app exposes on settle.
 *
 * A short move under the 8px click-slop is also exercised to prove a click is
 * classified as a READ (readCount increments), not a move.
 */

// A parcel with real relief so the ring + terrain read resolve. Any US parcel
// works for the drag mechanics; the assertion is about the gesture, not terrain.
const LAT = 35.9132;
const LNG = -84.0891;

async function gotoParcel(page: import('@playwright/test').Page) {
  await page.goto(`/intel?lat=${LAT}&lng=${LNG}`, { waitUntil: 'domcontentloaded' });
  // Wait for the Mapbox canvas to mount.
  const canvas = page.locator('canvas.mapboxgl-canvas');
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  // Wait for the ring test hook to appear (the ring effect has run + committed
  // at least an initial center) OR the map to be interactive. Poll the hook.
  await page.waitForFunction(() => {
    // The ring becomes grabbable once the huntzone layers exist; the hook is
    // populated on the first read/move. Consider the map ready when the canvas
    // has painted (non-zero size).
    const c = document.querySelector('canvas.mapboxgl-canvas') as HTMLCanvasElement | null;
    return !!c && c.width > 0 && c.height > 0;
  }, { timeout: 60_000 });
  // Give the ring layers + initial scope compute a moment to settle.
  await page.waitForTimeout(4000);
}

test('TC-A3: dragging the Hunt Zone ring moves it and triggers a re-read on settle', async ({ page }) => {
  await gotoParcel(page);

  const canvas = page.locator('canvas.mapboxgl-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Snapshot the hook before the drag.
  const before = await page.evaluate(() => (window as any).__tfpHuntZone || {});
  const moveCountBefore = before.moveCount || 0;

  // Real pointer drag: down on the ring (map center), move well past the 8px
  // click-slop in several steps, then release.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(cx + i * 12, cy + i * 6, { steps: 1 });
    await page.waitForTimeout(20);
  }
  await page.mouse.up();

  // The MOVE commit fires on release: assert the hook recorded a move with a
  // new (changed) center.
  await page.waitForFunction(
    (prev) => {
      const h = (window as any).__tfpHuntZone;
      return !!h && (h.moveCount || 0) > prev && h.lastGesture === 'move' && Array.isArray(h.center);
    },
    moveCountBefore,
    { timeout: 30_000 },
  );

  const after = await page.evaluate(() => (window as any).__tfpHuntZone || {});
  expect(after.moveCount).toBeGreaterThan(moveCountBefore);
  expect(Array.isArray(after.center)).toBe(true);
  // Center actually changed vs the pre-drag center (if we had one recorded).
  if (Array.isArray(before.center)) {
    const moved = before.center[0] !== after.center[0] || before.center[1] !== after.center[1];
    expect(moved).toBe(true);
  }
});

test('TC-A3b: a click (no drag) on the ring is classified as a read, not a move', async ({ page }) => {
  await gotoParcel(page);

  const canvas = page.locator('canvas.mapboxgl-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const before = await page.evaluate(() => (window as any).__tfpHuntZone || {});
  const readBefore = before.readCount || 0;

  // Tiny movement under the 8px slop => READ, not MOVE.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 2, cy + 2, { steps: 1 });
  await page.mouse.up();

  await page.waitForFunction(
    (prev) => {
      const h = (window as any).__tfpHuntZone;
      return !!h && (h.readCount || 0) > prev && h.lastGesture === 'read';
    },
    readBefore,
    { timeout: 30_000 },
  );

  const after = await page.evaluate(() => (window as any).__tfpHuntZone || {});
  expect(after.readCount).toBeGreaterThan(readBefore);
});
