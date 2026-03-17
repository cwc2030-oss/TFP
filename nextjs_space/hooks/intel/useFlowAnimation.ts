import { useEffect, type MutableRefObject } from 'react';
import type mapboxgl from 'mapbox-gl';

/**
 * v3.9 — Lightweight dash animation for travel-corridor flow lines.
 * Uses setInterval + Mapbox line-dasharray cycling instead of
 * requestAnimationFrame, which caused browser lockups after ~60s.
 */
export function useFlowAnimation(
  mapReady: boolean,
  mapRef: MutableRefObject<mapboxgl.Map | null>,
) {
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    let step = 0;
    const steps = [
      [6, 4], [5, 4, 1], [4, 4, 2], [3, 4, 3],
      [2, 4, 4], [1, 4, 5], [0.5, 4, 5.5]
    ];

    const interval = setInterval(() => {
      if (!mapRef.current || mapRef.current !== map) {
        clearInterval(interval);
        return;
      }
      try {
        if (map.getLayer('tfp-flow-primary') && !map.isMoving() && !map.isZooming()) {
          map.setPaintProperty(
            'tfp-flow-primary',
            'line-dasharray',
            steps[step % steps.length]
          );
          step++;
        }
      } catch (e) {
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [mapReady, mapRef]);
}
