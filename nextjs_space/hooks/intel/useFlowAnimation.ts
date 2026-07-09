import { useEffect, useRef, type MutableRefObject } from 'react';
import type mapboxgl from 'mapbox-gl';

/**
 * v5.0 — Unified animation for movement-related layers.
 *
 * Three cooperating loops (all pause during camera motion to avoid jank):
 *
 * 1) Corridor / draw dash crawl (setInterval 500ms):
 *    Corridors — every 5 ticks (2.5s) — subtle directional hint
 *    Draws     — every 8 ticks (4.0s) — barely perceptible structural pulse
 *
 * 2) Flow-tier directional crawl (setInterval 125ms) — NEW in v5.0:
 *    tfp-flow-green / tfp-flow-blue / tfp-flow-black get a slow, stealthy
 *    dash-crawl that travels in the direction of deer movement (same setDash
 *    technique as the corridors). A long dash + small traveling gap keeps the
 *    runs reading as near-solid lines while the gap glides forward — so the
 *    flow reads as ALIVE from first single-parcel load, not static.
 *    Intensity → motion: the black (heaviest) tier crawls a touch faster and
 *    with a more pronounced gap than green (lightest), so "more deer" literally
 *    reads as "more movement." The tfp-flow-direction-chevrons layer carries
 *    the explicit "this way" cue on top.
 *
 * 3) Flow glow pulse (requestAnimationFrame, ~6s full cycle):
 *    tfp-flow-tiers-glow — gentle sine-wave opacity + blur breathing beneath
 *    the crawl. Kept from v4.0; the crawl is layered ON TOP, not replacing it.
 */
export function useFlowAnimation(
  mapReady: boolean,
  mapRef: MutableRefObject<mapboxgl.Map | null>,
) {
  const glowRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const setDash = (layerId: string, pattern: number[]) => {
      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, 'line-dasharray', pattern);
      }
    };

    // ═══════════════════════════════════════════════════════════════════
    // PART 1: Corridor + draw dash crawl
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
    // PART 2: Flow-tier directional crawl (deer-flow runs actually travel)
    // ═══════════════════════════════════════════════════════════════════
    // A long dash with a small traveling GAP. As `frac` sweeps 0→1 the gap
    // glides forward along the line (direction of increasing vertex order,
    // i.e. the way the chevrons point), then wraps. Long dash + small gap ⇒
    // the run still reads as near-solid; only a faint notch travels.
    //
    // Mapbox line-dasharray semantics: [dash, gap, dash, gap, ...] — the first
    // element is always a drawn dash, so the gap is expressed as the middle
    // element and slid along by growing the leading dash.
    const crawlDash = (period: number, gap: number, frac: number): number[] => {
      const travel = period - gap;      // total drawn length (split before/after the gap)
      const EPS = 0.08;                 // Mapbox dislikes 0-length dash entries
      const a = Math.max(EPS, travel * frac);   // leading dash — grows 0→travel
      const b = travel - a;                     // trailing dash — shrinks travel→0
      if (b < EPS) return [a + b, gap];         // gap has reached the end → 2-element pattern
      return [a, gap, b];
    };

    // Per-tier tuning. Heaviest tier (black) = faster + more pronounced gap;
    // lightest tier (green) = slowest + most subtle. `speed` is the fraction of
    // a full crawl cycle advanced per 125ms tick.
    //   green: cycle ≈ 2.5s (0.050)  |  blue ≈ 2.1s (0.060)  |  black ≈ 1.7s (0.075)
    const flowTiers: { id: string; period: number; gap: number; speed: number }[] = [
      { id: 'tfp-flow-black', period: 12, gap: 4.0, speed: 0.075 }, // most deer → most motion
      { id: 'tfp-flow-blue',  period: 13, gap: 2.2, speed: 0.060 },
      { id: 'tfp-flow-green', period: 14, gap: 1.3, speed: 0.050 }, // subtlest, nearly solid
    ];

    const isTierHidden = (id: string): boolean => {
      try {
        return (map as any).getLayoutProperty(id, 'visibility') === 'none';
      } catch {
        return true;
      }
    };

    let flowFrame = 0;
    const FLOW_TICK_MS = 125; // ~8fps → smooth glide while staying cheap
    const flowInterval = setInterval(() => {
      if (!mapRef.current || mapRef.current !== map) {
        clearInterval(flowInterval);
        return;
      }
      try {
        // Pause during camera motion to avoid GPU contention / jank.
        if (map.isMoving() || map.isZooming()) return;

        flowFrame++;
        for (const tier of flowTiers) {
          if (!map.getLayer(tier.id) || isTierHidden(tier.id)) continue;
          const frac = (flowFrame * tier.speed) % 1;
          setDash(tier.id, crawlDash(tier.period, tier.gap, frac));
        }
      } catch {
        clearInterval(flowInterval);
      }
    }, FLOW_TICK_MS);

    // ═══════════════════════════════════════════════════════════════════
    // PART 3: Flow glow pulse (rAF-driven sine wave) — breathing underneath
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
      clearInterval(flowInterval);
      if (glowRafRef.current !== null) {
        cancelAnimationFrame(glowRafRef.current);
        glowRafRef.current = null;
      }
    };
  }, [mapReady, mapRef]);
}
