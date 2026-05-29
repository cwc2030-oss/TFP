/**
 * polyline-smooth.ts — Polyline smoothing utilities for map display.
 *
 * Uses Chaikin's corner-cutting algorithm to smooth jagged DEM-derived
 * polylines (ridge spines, flow lines) into visually clean curves
 * suitable for the Niehues ski-map aesthetic.
 *
 * Chaikin's algorithm: For each segment A→B, replace with two points
 * at 25% and 75% along the segment. Each pass roughly doubles the
 * point count while smoothing corners. The result converges toward
 * a quadratic B-spline.
 */

/**
 * Apply one pass of Chaikin's corner-cutting to a coordinate array.
 * Preserves first and last points (endpoints stay anchored).
 */
function chaikinPass(coords: number[][]): number[][] {
  if (coords.length < 3) return coords;

  const result: number[][] = [coords[0]]; // anchor start

  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    // Q = 0.75*A + 0.25*B
    result.push(a.map((v, j) => v * 0.75 + b[j] * 0.25));
    // R = 0.25*A + 0.75*B
    result.push(a.map((v, j) => v * 0.25 + b[j] * 0.75));
  }

  result.push(coords[coords.length - 1]); // anchor end
  return result;
}

/**
 * Smooth a single LineString's coordinates using Chaikin's algorithm.
 * @param coords - Array of [lng, lat] or [lng, lat, elev] coordinates
 * @param passes - Number of smoothing passes (default 2). More = smoother but more points.
 * @returns Smoothed coordinate array
 */
export function smoothLineCoords(coords: number[][], passes: number = 2): number[][] {
  if (coords.length < 3) return coords;

  let smoothed = coords;
  for (let p = 0; p < passes; p++) {
    smoothed = chaikinPass(smoothed);
  }
  return smoothed;
}

/**
 * Apply Douglas-Peucker simplification followed by Chaikin smoothing
 * to a FeatureCollection of LineStrings. This first removes redundant
 * micro-vertices (DEM noise), then smooths the result.
 *
 * @param fc - GeoJSON FeatureCollection containing LineString features
 * @param smoothPasses - Number of Chaikin passes (default 2)
 * @param simplifyTolerance - Douglas-Peucker tolerance in degrees (default 0.00005 ≈ ~5m)
 * @returns New FeatureCollection with smoothed geometries
 */
export function smoothFeatureCollection(
  fc: GeoJSON.FeatureCollection,
  smoothPasses: number = 2,
  simplifyTolerance: number = 0.00005,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.map(feature => {
      if (feature.geometry.type !== 'LineString') return feature;

      const coords = (feature.geometry as GeoJSON.LineString).coordinates;
      if (coords.length < 3) return feature;

      // Step 1: Douglas-Peucker simplification to remove DEM micro-noise
      const simplified = douglasPeucker(coords, simplifyTolerance);

      // Step 2: Chaikin smoothing for visual polish
      const smoothed = smoothLineCoords(simplified, smoothPasses);

      return {
        ...feature,
        geometry: {
          type: 'LineString' as const,
          coordinates: smoothed,
        },
      };
    }),
  };
}

// ============ Douglas-Peucker Simplification ============

/**
 * Perpendicular distance from point P to line segment A-B.
 * Works in degree space — acceptable for small geographic extents.
 */
function perpendicularDistance(p: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // A and B are the same point
    return Math.sqrt((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2);
  }

  // Project P onto line A-B, clamp to segment
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a[0] + t * dx;
  const projY = a[1] + t * dy;

  return Math.sqrt((p[0] - projX) ** 2 + (p[1] - projY) ** 2);
}

/**
 * Douglas-Peucker polyline simplification.
 * Removes points that deviate less than `tolerance` from the simplified line.
 */
function douglasPeucker(coords: number[][], tolerance: number): number[][] {
  if (coords.length <= 2) return coords;

  // Find the point with the maximum distance from the line start→end
  let maxDist = 0;
  let maxIdx = 0;

  const first = coords[0];
  const last = coords[coords.length - 1];

  for (let i = 1; i < coords.length - 1; i++) {
    const dist = perpendicularDistance(coords[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    // Recursively simplify both halves
    const left = douglasPeucker(coords.slice(0, maxIdx + 1), tolerance);
    const right = douglasPeucker(coords.slice(maxIdx), tolerance);
    return left.slice(0, -1).concat(right);
  } else {
    // All intermediate points are within tolerance — keep only endpoints
    return [first, last];
  }
}
