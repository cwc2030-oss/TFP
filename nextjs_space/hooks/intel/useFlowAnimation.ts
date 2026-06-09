import { useEffect, useRef, type MutableRefObject } from 'react';
import type mapboxgl from 'mapbox-gl';

/**
 * v4.0 — Unified animation for movement-related layers.
 *
 * Two independent animation loops:
 *
 * 1) Dash crawl (setInterval 500ms):
 *    Corridors — every 5 ticks (2.5s) — subtle directional hint
 *    Draws     — every 8 ticks (4.0s) — barely perceptible structural pulse
 *
 * 2) Flow glow pulse (requestAnimationFrame, ~6s full cycle):
 *    tfp-flow-tiers-glow — gentle sine-wave opacity oscillation (0.10 ↔ 0.30)
 *    Gives the Deer Flow a sense of "aliveness" from first parcel load.
 *    Also pulses line-blur (2.0 ↔ 3.5) for a soft breathing effect.
 *    Pauses during camera motion to avoid GPU contention.
 *
 * All layers pause during camera motion (isMoving/isZooming) to avoid jank.
 */
export function useFlowAnimation(
  mapReady: boolean,
  mapRef: MutableRefObject<mapboxgl.Map | null>,
) {
  const glowRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    // ═══════════════════════════════════════════════════════════════════
    // PART 1: Dash crawl animation (corridors + draws)
    // ═══════════════════════════════════════════════════════════════════
    let tick = 0;
    let corridorStep = 0;
    let drawStep = 0;

    // ── Corridors: long dash, subtle shift (11 unit cycle, 5 steps) ──
    const corridorSteps = [
      [8, 3], [7, 3, 1], [6, 3, 2], [5, 3, 3],
      [4, 3, 4]
    ];
    const corridorPossibleSteps = [
      [6, 3], [5, 3, 1], [4, 3, 2], [3, 3, 3],
      [2, 3, 4]
    ];
    const corridorExploratorySteps = [
      [4, 3], [3, 3, 1], [2, 3, 2], [1, 3, 3],
      [0.5, 3, 3.5]
    ];

    // ── Draws: very long dash, barely perceptible (12 unit cycle, 4 steps) ──
    const drawSteps = [
      [10, 2], [9, 2, 1], [8, 2, 2], [7, 2, 3]
    ];

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

        if (tick % 5 === 0) {
          setDash('tfp-corridors-primary', corridorSteps[corridorStep % corridorSteps.length]);
          setDash('tfp-corridors-possible', corridorPossibleSteps[corridorStep % corridorPossibleSteps.length]);
          setDash('tfp-corridors-exploratory', corridorExploratorySteps[corridorStep % corridorExploratorySteps.length]);
          corridorStep++;
        }

        if (tick % 8 === 0) {
          setDash('tfp-funnels-lines-draws', drawSteps[drawStep % drawSteps.length]);
          drawStep++;
        }
      } catch (e) {
        clearInterval(interval);
      }
    }, 500);

    // ═══════════════════════════════════════════════════════════════════
    // PART 2: Flow glow pulse (rAF-driven sine wave)
    // ═══════════════════════════════════════════════════════════════════
    const GLOW_CYCLE_MS = 6000;         // full sine cycle duration
    const GLOW_OPACITY_MIN = 0.10;      // trough
    const GLOW_OPACITY_MAX = 0.30;      // peak
    const GLOW_BLUR_MIN = 2.0;          // trough
    const GLOW_BLUR_MAX = 3.8;          // peak
    const GLOW_THROTTLE_MS = 80;        // ~12 fps — plenty smooth for glow
    let glowLastUpdate = 0;
    let glowStartTime = 0;

    const glowTick = (timestamp: number) => {
      if (!mapRef.current || mapRef.current !== map) return;

      // Initialize start time on first frame
      if (glowStartTime === 0) glowStartTime = timestamp;

      // Throttle to ~12 fps
      if (timestamp - glowLastUpdate < GLOW_THROTTLE_MS) {
        glowRafRef.current = requestAnimationFrame(glowTick);
        return;
      }
      glowLastUpdate = timestamp;

      try {
        // Pause during camera motion
        if (map.isMoving() || map.isZooming()) {
          glowRafRef.current = requestAnimationFrame(glowTick);
          return;
        }

        // Only animate if the glow layer exists and is visible
        if (!map.getLayer('tfp-flow-tiers-glow')) {
          glowRafRef.current = requestAnimationFrame(glowTick);
          return;
        }
        const layerObj = map.getLayer('tfp-flow-tiers-glow') as any;
        if (layerObj?.layout?.visibility === 'none') {
          glowRafRef.current = requestAnimationFrame(glowTick);
          return;
        }

        // Sine wave: 0→1→0 over GLOW_CYCLE_MS
        const elapsed = timestamp - glowStartTime;
        const t = (Math.sin((elapsed / GLOW_CYCLE_MS) * Math.PI * 2 - Math.PI / 2) + 1) / 2;

        const opacity = GLOW_OPACITY_MIN + t * (GLOW_OPACITY_MAX - GLOW_OPACITY_MIN);
        const blur = GLOW_BLUR_MIN + t * (GLOW_BLUR_MAX - GLOW_BLUR_MIN);

        map.setPaintProperty('tfp-flow-tiers-glow', 'line-opacity', opacity);
        map.setPaintProperty('tfp-flow-tiers-glow', 'line-blur', blur);
      } catch {
        // Layer may have been removed — stop
        return;
      }

      glowRafRef.current = requestAnimationFrame(glowTick);
    };

    // Start the glow pulse
    glowRafRef.current = requestAnimationFrame(glowTick);

    return () => {
      clearInterval(interval);
      if (glowRafRef.current !== null) {
        cancelAnimationFrame(glowRafRef.current);
        glowRafRef.current = null;
      }
    };
  }, [mapReady, mapRef]);
}
