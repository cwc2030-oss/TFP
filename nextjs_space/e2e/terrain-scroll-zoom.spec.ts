import { test, expect } from '@playwright/test';

/**
 * TC-A6 — Scroll-wheel zoom (REWRITTEN for r29).
 *
 * OLD meaning (r26): "scroll wheel is inert." That assertion is now WRONG —
 * r29 restored smooth, continuous wheel zoom (and trackpad pinch), zooming
 * toward the cursor, the way it worked before r26.
 *
 * NEW pass condition (per the r29 directive):
 *   Drag the ring OFF-center, then spin the wheel in/out repeatedly over the
 *   off-center ring ->
 *     - the MAP ZOOMS smoothly (map.getZoom() changes),
 *     - the ring stays glued to its GROUND coordinates (its geographic center
 *       does NOT change — it only scales/repositions on screen, no diagonal
 *       walk, no oscillation),
 *     - NO read fires (readCount holds; numbers/message do not roll in).
 *
 * Reads stay pan-only + ring-drag-only; zoom is view-only. We assert via the
 * window.__TFP_MAP__ (mapbox instance) + window.__tfpHuntZone (ring/read hook)
 * the app already exposes.
 */

const LAT = 35.9132;
const LNG = -84.0891;

async function gotoParcel(page: import('@playwright/test').Page) {
  await page.goto(`/intel?lat=${LAT}&lng=${LNG}`, { waitUntil: 'domcontentloaded' });
  const canvas = page.locator('canvas.mapboxgl-canvas');
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas.mapboxgl-canvas') as HTMLCanvasElement | null;
    return !!c && c.width > 0 && c.height > 0 && !!(window as any).__TFP_MAP__;
  }, { timeout: 60_000 });
  await page.waitForTimeout(4000);
}

test('TC-A6: wheel zoom over an off-center ring zooms the map, keeps the ring on its ground, and fires no read', async ({ page }) => {
  await gotoParcel(page);

  const canvas = page.locator('canvas.mapboxgl-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // 1) Drag the ring OFF-center (the gesture that broke zoom before r26).
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(cx + i * 12, cy + i * 6, { steps: 1 });
    await page.waitForTimeout(20);
  }
  await page.mouse.up();

  // Let the move settle + record the ring's ground center and read count.
  await page.waitForFunction(() => {
    const h = (window as any).__tfpHuntZone;
    return !!h && Array.isArray(h.center);
  }, { timeout: 30_000 });

  const afterDrag = await page.evaluate(() => {
    const map = (window as any).__TFP_MAP__;
    const h = (window as any).__tfpHuntZone || {};
    return {
      zoom: map ? map.getZoom() : null,
      readCount: h.readCount || 0,
      center: Array.isArray(h.center) ? [...h.center] : null,
    };
  });
  expect(afterDrag.zoom).not.toBeNull();
  expect(afterDrag.center).not.toBeNull();

  // 2) Spin the wheel in/out repeatedly OVER the off-center ring position.
  const ringPx = { x: cx + 120, y: cy + 60 };
  await page.mouse.move(ringPx.x, ringPx.y);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -240); // zoom in
    await page.waitForTimeout(120);
  }
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 240); // zoom back out
    await page.waitForTimeout(120);
  }
  // Allow the camera to settle.
  await page.waitForTimeout(1200);

  const afterZoom = await page.evaluate(() => {
    const map = (window as any).__TFP_MAP__;
    const h = (window as any).__tfpHuntZone || {};
    return {
      zoom: map ? map.getZoom() : null,
      readCount: h.readCount || 0,
      center: Array.isArray(h.center) ? [...h.center] : null,
      lastGesture: h.lastGesture,
    };
  });

  // The MAP ZOOMED (zoom level moved from the post-drag value).
  expect(afterZoom.zoom).not.toBeNull();
  expect(Math.abs((afterZoom.zoom as number) - (afterDrag.zoom as number))).toBeGreaterThan(0.25);

  // NO read fired from the wheel: read count held.
  expect(afterZoom.readCount).toBe(afterDrag.readCount);

  // The ring stayed glued to its GROUND coordinates (geographic center held to
  // within a hair — no diagonal walk, no oscillation from zoom).
  if (afterDrag.center && afterZoom.center) {
    const dLng = Math.abs(afterZoom.center[0] - afterDrag.center[0]);
    const dLat = Math.abs(afterZoom.center[1] - afterDrag.center[1]);
    expect(dLng).toBeLessThan(1e-6);
    expect(dLat).toBeLessThan(1e-6);
  }
});
