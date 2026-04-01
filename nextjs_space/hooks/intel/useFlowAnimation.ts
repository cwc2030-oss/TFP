import { useEffect, type MutableRefObject } from 'react';
import type mapboxgl from 'mapbox-gl';

/**
 * v3.9.1 — Lightweight dash animation for travel-corridor flow lines.
 * Uses setInterval + Mapbox line-dasharray cycling instead of
 * requestAnimationFrame, which caused browser lockups after ~60s.
 *
 * Primary flow: 500ms tick, full dash sequence (7 steps)
 * Secondary flow: ~750ms effective tick (advances every 3rd primary tick),
 *   shorter dash pattern for subtler, background "alive" feel.
 */
export function useFlowAnimation(
  mapReady: boolean,
  mapRef: MutableRefObject<mapboxgl.Map | null>,
) {
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    let primaryStep = 0;
    let secondaryStep = 0;
    let tick = 0;

    // Primary: bold dash sequence (dash 6, gap 4 total = 10 units)
    const primarySteps = [
      [6, 4], [5, 4, 1], [4, 4, 2], [3, 4, 3],
      [2, 4, 4], [1, 4, 5], [0.5, 4, 5.5]
    ];

    // Secondary: shorter, tighter dash sequence (dash 4, gap 3 total = 7 units)
    // Subtler movement that reads as "background alive"
    const secondarySteps = [
      [4, 3], [3, 3, 1], [2, 3, 2], [1, 3, 3],
      [0.5, 3, 3.5]
    ];

    const interval = setInterval(() => {
      if (!mapRef.current || mapRef.current !== map) {
        clearInterval(interval);
        return;
      }
      try {
        const idle = !map.isMoving() && !map.isZooming();
        if (!idle) return;

        // Primary: advance every tick (500ms)
        if (map.getLayer('tfp-flow-primary')) {
          map.setPaintProperty(
            'tfp-flow-primary',
            'line-dasharray',
            primarySteps[primaryStep % primarySteps.length]
          );
          primaryStep++;
        }

        // Secondary: advance every 3rd tick (~1500ms per cycle step)
        // This gives ~0.33x the animation speed of primary
        tick++;
        if (tick % 3 === 0 && map.getLayer('tfp-flow-secondary')) {
          map.setPaintProperty(
            'tfp-flow-secondary',
            'line-dasharray',
            secondarySteps[secondaryStep % secondarySteps.length]
          );
          secondaryStep++;
        }
      } catch (e) {
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [mapReady, mapRef]);
}
