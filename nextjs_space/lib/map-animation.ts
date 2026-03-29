/**
 * V4 Step 11 — Map Choreography Utilities
 * Smooth fade transitions for Mapbox GL layer properties.
 * Designed for demo-quality visual polish.
 */

import type mapboxgl from 'mapbox-gl';

// mapbox-gl v1 types don't expose getPaintProperty, but it exists at runtime
type MapWithGetPaint = mapboxgl.Map & {
  getPaintProperty(layerId: string, property: string): any;
};

// Active animation cancellation tokens
const activeAnimations = new Map<string, number>();

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

/**
 * Fade a layer IN: set visibility to 'visible', then animate opacity up.
 * If the layer uses an expression-based opacity, it fades to a simple numeric target.
 */
export function fadeLayerIn(
  map: mapboxgl.Map,
  layerId: string,
  targetOpacity: number,
  opacityProp: string = 'line-opacity',
  durationMs: number = 350,
): void {
  if (!map.getLayer(layerId)) return;
  // Ensure visible first
  map.setLayoutProperty(layerId, 'visibility', 'visible');
  // Start from 0 (override any expression to a numeric start)
  try {
    const current = (map as MapWithGetPaint).getPaintProperty(layerId, opacityProp);
    if (typeof current !== 'number') {
      map.setPaintProperty(layerId, opacityProp, 0);
    }
  } catch {
    map.setPaintProperty(layerId, opacityProp, 0);
  }
  animatePaint(map, layerId, opacityProp, targetOpacity, durationMs);
}

/**
 * Fade a layer OUT: animate opacity to 0, then set visibility to 'none'.
 */
export function fadeLayerOut(
  map: mapboxgl.Map,
  layerId: string,
  opacityProp: string = 'line-opacity',
  durationMs: number = 280,
): void {
  if (!map.getLayer(layerId)) return;
  // Read current opacity for smooth fade-out start
  let startOpacity = 0;
  try {
    const current = (map as MapWithGetPaint).getPaintProperty(layerId, opacityProp);
    startOpacity = typeof current === 'number' ? current : 0.5;
  } catch {
    startOpacity = 0.5;
  }
  // If already invisible, just ensure hidden
  if (startOpacity < 0.01) {
    map.setLayoutProperty(layerId, 'visibility', 'none');
    return;
  }
  // Set to numeric start so the animation works
  map.setPaintProperty(layerId, opacityProp, startOpacity);

  const animKey = `${layerId}::${opacityProp}`;
  const prev = activeAnimations.get(animKey);
  if (prev) cancelAnimationFrame(prev);

  const startTime = performance.now();

  function step(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    const eased = easeInOutCubic(progress);
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
      // Animation complete — hide the layer
      try {
        map.setLayoutProperty(layerId, 'visibility', 'none');
      } catch { /* ignore */ }
      activeAnimations.delete(animKey);
    }
  }

  activeAnimations.set(animKey, requestAnimationFrame(step));
}

/**
 * Batch fade multiple layers in/out based on a boolean toggle.
 * Each entry specifies the layer, its target opacity, and which paint property to animate.
 */
export function fadeToggleLayers(
  map: mapboxgl.Map,
  show: boolean,
  layers: Array<{
    id: string;
    targetOpacity: number;
    opacityProp?: string; // defaults to 'line-opacity'
  }>,
  durationMs: number = 320,
): void {
  layers.forEach(({ id, targetOpacity, opacityProp }) => {
    const prop = opacityProp || 'line-opacity';
    if (show) {
      fadeLayerIn(map, id, targetOpacity, prop, durationMs);
    } else {
      fadeLayerOut(map, id, prop, durationMs);
    }
  });
}

/**
 * Cancel all running animations (cleanup on unmount).
 */
export function cancelAllAnimations(): void {
  activeAnimations.forEach((frameId) => cancelAnimationFrame(frameId));
  activeAnimations.clear();
}

// --- Easing functions ---
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
