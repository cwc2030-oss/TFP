/**
 * V4 Step 11+11b — Map Choreography Utilities
 * Smooth fade transitions for Mapbox GL layer properties.
 * Designed for demo-quality, cinematic visual polish.
 *
 * Step 11b additions:
 *  - staggeredFadeToggle: cascading layer reveals/hides with per-layer delay
 *  - orchestratedReveal: timed sequence for initial parcel load ("cinematic intro")
 *  - gracefulClear: fade-out all visible layers before clearing data sources
 *  - additional easing curves (easeOutQuart, easeInQuart)
 */

import type mapboxgl from 'mapbox-gl';

// mapbox-gl v1 types don't expose getPaintProperty, but it exists at runtime
type MapWithGetPaint = mapboxgl.Map & {
  getPaintProperty(layerId: string, property: string): any;
};

// Active animation cancellation tokens
const activeAnimations = new Map<string, number>();

// ─── Easing functions ────────────────────────────────────────────────
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
export function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}
export function easeInQuart(t: number): number {
  return t * t * t * t;
}
/** Slow start, faster end — great for "reveal" moments */
export function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

// ─── Core paint animator ─────────────────────────────────────────────

/**
 * Smoothly animate a numeric paint property on a Mapbox layer.
 * Cancels any in-progress animation on the same layer+property.
 */
export function animatePaint(
  map: mapboxgl.Map,
  layerId: string,
  property: string,
  targetValue: number,
  durationMs: number = 320,
  easeFn: (t: number) => number = easeInOutCubic,
): void {
  if (!map.getLayer(layerId)) return;

  const animKey = `${layerId}::${property}`;

  // Cancel any in-flight animation on this layer+prop
  const prev = activeAnimations.get(animKey);
  if (prev) cancelAnimationFrame(prev);

  // Read current value — getPaintProperty can return expressions or numbers
  let startValue: number;
  try {
    const current = (map as MapWithGetPaint).getPaintProperty(layerId, property);
    startValue = typeof current === 'number' ? current : targetValue;
  } catch {
    startValue = targetValue;
  }

  // If already at target, skip
  if (Math.abs(startValue - targetValue) < 0.001) {
    activeAnimations.delete(animKey);
    return;
  }

  const startTime = performance.now();
  const delta = targetValue - startValue;

  function step(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    const eased = easeFn(progress);
    const value = startValue + delta * eased;

    try {
      map.setPaintProperty(layerId, property, value);
    } catch {
      activeAnimations.delete(animKey);
      return;
    }

    if (progress < 1) {
      activeAnimations.set(animKey, requestAnimationFrame(step));
    } else {
      activeAnimations.delete(animKey);
    }
  }

  activeAnimations.set(animKey, requestAnimationFrame(step));
}

// ─── Layer fade helpers ──────────────────────────────────────────────

/**
 * Fade a layer IN: set visibility to 'visible', then animate opacity up.
 */
export function fadeLayerIn(
  map: mapboxgl.Map,
  layerId: string,
  targetOpacity: number,
  opacityProp: string = 'line-opacity',
  durationMs: number = 400,
  easeFn: (t: number) => number = easeOutQuart,
): void {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, 'visibility', 'visible');
  try {
    const current = (map as MapWithGetPaint).getPaintProperty(layerId, opacityProp);
    if (typeof current !== 'number') {
      map.setPaintProperty(layerId, opacityProp, 0);
    }
  } catch {
    map.setPaintProperty(layerId, opacityProp, 0);
  }
  animatePaint(map, layerId, opacityProp, targetOpacity, durationMs, easeFn);
}

/**
 * Fade a layer OUT: animate opacity to 0, then set visibility to 'none'.
 */
export function fadeLayerOut(
  map: mapboxgl.Map,
  layerId: string,
  opacityProp: string = 'line-opacity',
  durationMs: number = 300,
  easeFn: (t: number) => number = easeInQuart,
): void {
  if (!map.getLayer(layerId)) return;
  let startOpacity = 0;
  try {
    const current = (map as MapWithGetPaint).getPaintProperty(layerId, opacityProp);
    startOpacity = typeof current === 'number' ? current : 0.5;
  } catch {
    startOpacity = 0.5;
  }
  if (startOpacity < 0.01) {
    map.setLayoutProperty(layerId, 'visibility', 'none');
    return;
  }
  map.setPaintProperty(layerId, opacityProp, startOpacity);

  const animKey = `${layerId}::${opacityProp}`;
  const prev = activeAnimations.get(animKey);
  if (prev) cancelAnimationFrame(prev);

  const startTime = performance.now();

  function step(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    const eased = easeFn(progress);
    const value = startOpacity * (1 - eased);

    try {
      map.setPaintProperty(layerId, opacityProp, value);
    } catch {
      activeAnimations.delete(animKey);
      return;
    }

    if (progress < 1) {
      activeAnimations.set(animKey, requestAnimationFrame(step));
    } else {
      try {
        map.setLayoutProperty(layerId, 'visibility', 'none');
      } catch { /* ignore */ }
      activeAnimations.delete(animKey);
    }
  }

  activeAnimations.set(animKey, requestAnimationFrame(step));
}

// ─── Batch toggle (unchanged API, improved defaults) ─────────────────

export function fadeToggleLayers(
  map: mapboxgl.Map,
  show: boolean,
  layers: Array<{
    id: string;
    targetOpacity: number;
    opacityProp?: string;
  }>,
  durationMs: number = 380,
): void {
  layers.forEach(({ id, targetOpacity, opacityProp }) => {
    const prop = opacityProp || 'line-opacity';
    if (show) {
      fadeLayerIn(map, id, targetOpacity, prop, durationMs, easeOutQuart);
    } else {
      fadeLayerOut(map, id, prop, Math.round(durationMs * 0.75), easeInQuart);
    }
  });
}

// ─── NEW: Staggered toggle (cascading reveal / hide) ─────────────────

export interface StaggerLayer {
  id: string;
  targetOpacity: number;
  opacityProp?: string;
}

/**
 * Fade layers in/out with a cascading stagger delay between each.
 * Creates a "drawing on" / "erasing" effect that feels intentional.
 *
 * @param staggerMs  Delay between each consecutive layer start (default 60ms)
 */
export function staggeredFadeToggle(
  map: mapboxgl.Map,
  show: boolean,
  layers: StaggerLayer[],
  durationMs: number = 400,
  staggerMs: number = 60,
): void {
  const ordered = show ? layers : [...layers].reverse();
  ordered.forEach(({ id, targetOpacity, opacityProp }, i) => {
    const prop = opacityProp || 'line-opacity';
    const delay = i * staggerMs;
    setTimeout(() => {
      if (show) {
        fadeLayerIn(map, id, targetOpacity, prop, durationMs, easeOutQuart);
      } else {
        fadeLayerOut(map, id, prop, Math.round(durationMs * 0.7), easeInQuart);
      }
    }, delay);
  });
}

// ─── NEW: Graceful clear (fade out everything, THEN wipe sources) ────

/**
 * Smoothly fades out all currently visible TFP layers before clearing data sources.
 * Returns a promise that resolves after the fade-out completes.
 * Prevents the "pop" effect when switching parcels.
 *
 * @param fadeMs  Duration of the fade-out animation
 */
export function gracefulClear(
  map: mapboxgl.Map,
  sourceIds: string[],
  fadeMs: number = 250,
): Promise<void> {
  // Collect all visible layers that belong to tfp- sources
  const visibleLayers: Array<{ id: string; prop: string }> = [];
  let style: mapboxgl.Style | undefined;
  try {
    if (!map.isStyleLoaded()) {
      console.error('[INTEL-DIAG] gracefulClear: style not loaded — skipping getStyle()');
      return Promise.resolve();
    }
    style = map.getStyle();
  } catch (e) {
    console.error('[INTEL-DIAG] gracefulClear: getStyle() threw', e);
    return Promise.resolve();
  }
  if (style?.layers) {
    for (const layer of style.layers) {
      if (!layer.id.startsWith('tfp-')) continue;
      if (layer.layout?.visibility === 'none') continue;
      // Determine the opacity paint property for this layer type
      const propMap: Record<string, string> = {
        line: 'line-opacity',
        fill: 'fill-opacity',
        circle: 'circle-opacity',
        heatmap: 'heatmap-opacity',
        symbol: 'icon-opacity',
      };
      const prop = propMap[(layer as any).type] || 'line-opacity';
      visibleLayers.push({ id: layer.id, prop });
    }
  }

  // Fade them all out simultaneously
  visibleLayers.forEach(({ id, prop }) => {
    fadeLayerOut(map, id, prop, fadeMs, easeInQuart);
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      // Now clear the underlying data sources
      const emptyFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
      for (const srcId of sourceIds) {
        try {
          const src = map.getSource(srcId) as mapboxgl.GeoJSONSource | undefined;
          if (src) src.setData(emptyFC);
        } catch { /* source may not exist */ }
      }
      resolve();
    }, fadeMs + 50); // small buffer after animation
  });
}

// ─── NEW: Orchestrated reveal (cinematic layer intro) ────────────────

export interface RevealStep {
  layers: StaggerLayer[];
  delayAfterMs?: number; // pause before next step (default 100)
}

/**
 * Play a timed sequence of layer reveals for a "cinematic intro" feel.
 * Each step fades in a group of layers, then waits before the next step.
 * Great for initial parcel load.
 */
export function orchestratedReveal(
  map: mapboxgl.Map,
  steps: RevealStep[],
  baseDurationMs: number = 450,
): void {
  let cumulativeDelay = 0;
  steps.forEach((step) => {
    const delay = cumulativeDelay;
    setTimeout(() => {
      step.layers.forEach(({ id, targetOpacity, opacityProp }, i) => {
        const prop = opacityProp || 'line-opacity';
        // Stagger within each step (30ms between layers in same group)
        setTimeout(() => {
          fadeLayerIn(map, id, targetOpacity, prop, baseDurationMs, easeOutExpo);
        }, i * 30);
      });
    }, delay);
    cumulativeDelay += (step.delayAfterMs ?? 100);
  });
}

// ─── Cleanup ─────────────────────────────────────────────────────────

export function cancelAllAnimations(): void {
  activeAnimations.forEach((frameId) => cancelAnimationFrame(frameId));
  activeAnimations.clear();
}
