/**
 * polyline-smooth.ts — Polyline smoothing utilities for map display.
 *
 * Two smoothing pipelines:
 * 1. Chaikin corner-cutting (for ridge spines) — fast, approximating
 * 2. Catmull-Rom spline (for flow lines / primary path) — passes through
 *    all waypoints for a truer representation of the terrain route
 *
 * Both pipelines use Douglas-Peucker as a first pass to remove DEM micro-noise
 * before applying the smooth interpolation.
 */

// ============ Chaikin Corner-Cutting ============

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

// ============ Catmull-Rom Spline Interpolation ============

/**
 * Compute a single point on a Catmull-Rom segment.
 * Standard formulation (equivalent to tension = 0.5 cardinal spline).
 * Passes through P1 and P2; P0 and P3 are neighboring control points.
 */
function catmullRomPoint(
  p0: number[], p1: number[], p2: number[], p3: number[],
  t: number, alpha: number
): number[] {
  const t2 = t * t;
  const t3 = t2 * t;
  const dims = Math.min(p0.length, p1.length, p2.length, p3.length);
  const result: number[] = [];

  // Cardinal spline with tension alpha (0.5 = standard Catmull-Rom)
  for (let d = 0; d < dims; d++) {
    result.push(
      alpha * (
        (-t3 + 2 * t2 - t) * p0[d] +
        (3 * t3 - 5 * t2 + 2) * p1[d] +
        (-3 * t3 + 4 * t2 + t) * p2[d] +
        (t3 - t2) * p3[d]
      )
    );
  }

  return result;
}

/**
 * Catmull-Rom spline interpolation through control points.
 * Produces a smooth curve that passes through every waypoint.
 *
 * @param coords - Control points [lng, lat] or [lng, lat, elev]
 * @param tension - Curve tension. 0.5 = standard Catmull-Rom. Default 0.5
 * @param segmentsPerSpan - Interpolated points between each pair. Default 8
 * @returns Smoothed coordinate array passing through all original points
 */
export function catmullRomInterpolate(
  coords: number[][],
  tension: number = 0.5,
  segmentsPerSpan: number = 8,
): number[][] {
  if (coords.length < 3) return coords;

  const result: number[][] = [coords[0]];

  for (let i = 0; i < coords.length - 1; i++) {
    // Use clamped boundary indices (repeat endpoints)
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];

    // Interpolate between p1 and p2
    for (let s = 1; s <= segmentsPerSpan; s++) {
      result.push(catmullRomPoint(p0, p1, p2, p3, s / segmentsPerSpan, tension));
    }
  }

  return result;
}

/**
 * Smooth flow lines for display using Douglas-Peucker + Catmull-Rom.
 * This is the primary smoothing pipeline for deer flow lines and the
 * Primary Path — produces curves that pass through terrain waypoints.
 *
 * The `pathSmoothing` parameter (0–1.0) controls aggressiveness:
 * - 0: No smoothing (raw DEM-derived polylines)
 * - 0.3: Light smoothing (removes micro-jitter, preserves detail)
 * - 0.7: Default (good balance of readability and fidelity)
 * - 1.0: Maximum smoothing (clean arcs, some terrain detail lost)
 *
 * @param fc - FeatureCollection of flow LineStrings
 * @param pathSmoothing - 0 (raw) to 1.0 (max smooth). Default 0.7
 * @returns New FeatureCollection with smoothed geometries (properties preserved)
 */
export function smoothFlowFeatureCollection(
  fc: GeoJSON.FeatureCollection,
  pathSmoothing: number = 0.7,
): GeoJSON.FeatureCollection {
  if (pathSmoothing <= 0) return fc;

  // Scale Douglas-Peucker epsilon with smoothing level
  // 0.3 → ~0.00006° ≈ 7m, 0.7 → ~0.00010° ≈ 11m, 1.0 → ~0.00013° ≈ 15m
  const epsilon = 0.00004 + pathSmoothing * 0.00009;

  // More segments for smoother curves (4 at low smoothing, 10 at max)
  const segments = Math.max(4, Math.round(4 + pathSmoothing * 6));

  return {
    type: 'FeatureCollection',
    features: fc.features.map(feature => {
      if (feature.geometry.type !== 'LineString') return feature;

      const coords = (feature.geometry as GeoJSON.LineString).coordinates;
      if (coords.length < 3) return feature;

      // Step 1: Douglas-Peucker to remove DEM micro-noise
      const simplified = douglasPeucker(coords, epsilon);

      // Need at least 3 points for Catmull-Rom
      if (simplified.length < 3) {
        return {
          ...feature,
          geometry: { type: 'LineString' as const, coordinates: simplified },
        };
      }

      // Step 2: Catmull-Rom for smooth curves through terrain waypoints
      const smoothed = catmullRomInterpolate(simplified, 0.5, segments);

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
export function douglasPeucker(coords: number[][], tolerance: number): number[][] {
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
