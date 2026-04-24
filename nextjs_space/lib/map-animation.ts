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

// Paint properties whose values must be clamped to [0, 1] per Mapbox style spec.
// Passing a value outside this range (even by a tiny floating-point epsilon) makes
// Mapbox emit a style-validation warning AND leaves the internal property state
// partially undefined, which later causes `TypeError: Cannot read properties of
// undefined (reading 'value')` when subsequent getPaintProperty / setPaintProperty
// calls try to read or update that property. Clamping prevents the whole crash.
const OPACITY_PROPS = new Set<string>([
  'line-opacity',
  'fill-opacity',
  'circle-opacity',
  'circle-stroke-opacity',
  'heatmap-opacity',
  'icon-opacity',
  'text-opacity',
  'fill-extrusion-opacity',
  'raster-opacity',
  'background-opacity',
]);

function clampForProperty(property: string, value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (OPACITY_PROPS.has(property)) {
    if (value < 0) return 0;
    if (value > 1) return 1;
  }
  return value;
}

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
  // Clamp readback — a residual out-of-range value from a prior broken animation
  // or stale style could propagate through here.
  startValue = clampForProperty(property, startValue);
  // Also clamp the requested target so we never animate to an invalid value.
  const clampedTarget = clampForProperty(property, targetValue);

  // If already at target, skip
  if (Math.abs(startValue - clampedTarget) < 0.001) {
    activeAnimations.delete(animKey);
    return;
  }

  const startTime = performance.now();
  const delta = clampedTarget - startValue;

  function step(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    const eased = easeFn(progress);
    // Clamp to valid range for opacity-style props to avoid Mapbox validation
    // warnings AND the downstream TypeError that negative opacities can trigger.
    const value = clampForProperty(property, startValue + delta * eased);

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
 * Fade a layer OUT: animate opacity to 0.
 *
 * v4-fix9: Added `setHidden` parameter. When true (default), also sets
 * visibility:'none' after fade completes — correct for user toggle actions.
 * When false, leaves visibility unchanged — correct for gracefulClear so the
 * centralized reconcile controller decides final visibility.
 */
export function fadeLayerOut(
  map: mapboxgl.Map,
  layerId: string,
  opacityProp: string = 'line-opacity',
  durationMs: number = 300,
  easeFn: (t: number) => number = easeInQuart,
  setHidden: boolean = true,
): void {
  if (!map.getLayer(layerId)) return;
  let startOpacity = 0;
  try {
    const current = (map as MapWithGetPaint).getPaintProperty(layerId, opacityProp);
    startOpacity = typeof current === 'number' ? current : 0.5;
  } catch {
    startOpacity = 0.5;
  }
  // Clamp readback value — a residual negative opacity from a prior broken
  // animation could leak through here and re-trigger the Mapbox crash.
  startOpacity = clampForProperty(opacityProp, startOpacity);
  if (startOpacity < 0.01) {
    if (setHidden) {
      try { map.setLayoutProperty(layerId, 'visibility', 'none'); } catch { /* ignore */ }
    }
    return;
  }
  try { map.setPaintProperty(layerId, opacityProp, startOpacity); } catch { /* ignore */ }

  const animKey = `${layerId}::${opacityProp}`;
  const prev = activeAnimations.get(animKey);
  if (prev) cancelAnimationFrame(prev);

  const startTime = performance.now();

  function step(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    const eased = easeFn(progress);
    // Clamp to valid range for opacity-style props to avoid Mapbox validation
    // warnings AND the downstream TypeError that negative opacities can trigger.
    const value = clampForProperty(opacityProp, startOpacity * (1 - eased));

    try {
      map.setPaintProperty(layerId, opacityProp, value);
    } catch {
      activeAnimations.delete(animKey);
      return;
    }

    if (progress < 1) {
      activeAnimations.set(animKey, requestAnimationFrame(step));
    } else {
      if (setHidden) {
        try { map.setLayoutProperty(layerId, 'visibility', 'none'); } catch { /* ignore */ }
      }
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
  /** v4-fix13: Layer IDs matching these prefixes are kept visible during clear */
  preserveLayerPrefixes: string[] = [],
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
      // v4-fix13: Skip preserved layers (e.g. parcel boundary)
      if (preserveLayerPrefixes.some(p => layer.id.startsWith(p))) continue;
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

  // v4-fix9: Fade all layers to opacity 0 but do NOT set visibility:'none'.
  // The centralized reconcileVisibility() controller will decide final state
  // after new data is painted. This prevents orphaned hidden layers.
  visibleLayers.forEach(({ id, prop }) => {
    fadeLayerOut(map, id, prop, fadeMs, easeInQuart, false);
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
