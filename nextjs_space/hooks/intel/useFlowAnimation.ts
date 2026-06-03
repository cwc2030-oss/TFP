import { useEffect, type MutableRefObject } from 'react';
import type mapboxgl from 'mapbox-gl';

/**
 * v4.0 — Unified dash animation for movement-related layers.
 * Single setInterval (500ms) drives the animation hierarchy:
 *
 *   Corridors — every 5 ticks (2.5s) — subtle directional hint
 *   Draws     — every 8 ticks (4.0s) — barely perceptible structural pulse
 *
 * Phase B: Flow tier layers (green/blue/black) use static paint properties
 * (green/blue solid, black dashed 8/4) — no animation needed.
 * All layers pause during camera motion (isMoving/isZooming) to avoid jank.
 */
export function useFlowAnimation(
  mapReady: boolean,
  mapRef: MutableRefObject<mapboxgl.Map | null>,
) {
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    let tick = 0;
    let corridorStep = 0;
    let drawStep = 0;

    // ── Corridors: long dash, subtle shift (11 unit cycle, 5 steps) ──
    // Looks nearly solid but with gentle directional crawl
    const corridorSteps = [
      [8, 3], [7, 3, 1], [6, 3, 2], [5, 3, 3],
      [4, 3, 4]
    ];

    // Possible corridors: slightly shorter pattern
    const corridorPossibleSteps = [
      [6, 3], [5, 3, 1], [4, 3, 2], [3, 3, 3],
      [2, 3, 4]
    ];

    // Exploratory corridors: existing [4,3] pattern, minimal shift
    const corridorExploratorySteps = [
      [4, 3], [3, 3, 1], [2, 3, 2], [1, 3, 3],
      [0.5, 3, 3.5]
    ];

    // ── Draws: very long dash, barely perceptible (12 unit cycle, 4 steps) ──
    // Structural pathways — almost static, slow ambient pulse
    const drawSteps = [
      [10, 2], [9, 2, 1], [8, 2, 2], [7, 2, 3]
    ];

    // Helper: safely set dasharray on a layer
    const setDash = (layerId: string, pattern: number[]) => {
      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, 'line-dasharray', pattern);
      }
    };

    const interval = setInterval(() => {
      if (!mapRef.current || mapRef.current !== map) {
        clearInterval(interval);
        return;
      }
      try {
        const idle = !map.isMoving() && !map.isZooming();
        if (!idle) return;

        tick++;

        // Corridors: every 5th tick (~2.5s)
        if (tick % 5 === 0) {
          setDash('tfp-corridors-primary', corridorSteps[corridorStep % corridorSteps.length]);
          setDash('tfp-corridors-possible', corridorPossibleSteps[corridorStep % corridorPossibleSteps.length]);
          setDash('tfp-corridors-exploratory', corridorExploratorySteps[corridorStep % corridorExploratorySteps.length]);
          corridorStep++;
        }

        // Draws: every 8th tick (~4s)
        if (tick % 8 === 0) {
          setDash('tfp-funnels-lines-draws', drawSteps[drawStep % drawSteps.length]);
          drawStep++;
        }
      } catch (e) {
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [mapReady, mapRef]);
}
