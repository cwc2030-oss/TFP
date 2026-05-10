/**
 * clip-to-parcel.ts — Client-side GeoJSON line clipping
 *
 * Clips LineString features to parcel boundary + configurable buffer.
 * The terrain brain still receives full 800m context; this only affects
 * what gets displayed on the Mapbox map.
 */
import * as turf from '@turf/turf';

// Default display buffer in meters — enough to show deer entering/exiting
const DEFAULT_DISPLAY_BUFFER_M = 50;

/**
 * Given a point [lng, lat] between two points a and b,
 * find the interpolation parameter t such that lerp(a, b, t) ≈ point.
 * Used to find polygon boundary crossing points.
 */
function findCrossingPoint(
  inside: [number, number],
  outside: [number, number],
  clipPoly: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  steps = 8
): [number, number] {
  let lo = 0;
  let hi = 1;
  let mid: [number, number] = inside;
  for (let i = 0; i < steps; i++) {
    const t = (lo + hi) / 2;
    mid = [
      inside[0] + (outside[0] - inside[0]) * t,
      inside[1] + (outside[1] - inside[1]) * t,
    ];
    if (turf.booleanPointInPolygon(mid, clipPoly)) {
      lo = t;
    } else {
      hi = t;
    }
  }
  // Return the last known inside point at midpoint resolution
  const tFinal = (lo + hi) / 2;
  return [
    inside[0] + (outside[0] - inside[0]) * lo,
    inside[1] + (outside[1] - inside[1]) * lo,
  ];
}

/**
 * Clip a single LineString coordinate array to the given polygon.
 * Returns an array of coordinate arrays (may split into multiple segments
 * if the line exits and re-enters the polygon).
 */
function clipLineCoords(
  coords: [number, number][],
  clipPoly: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
): [number, number][][] {
  if (coords.length < 2) return [];

  const segments: [number, number][][] = [];
  let current: [number, number][] = [];

  for (let i = 0; i < coords.length; i++) {
    const pt = coords[i];
    const inside = turf.booleanPointInPolygon(pt, clipPoly);

    if (inside) {
      // If previous point was outside, find crossing and start new segment
      if (i > 0 && current.length === 0) {
        const prev = coords[i - 1];
        const prevInside = turf.booleanPointInPolygon(prev, clipPoly);
        if (!prevInside) {
          const crossing = findCrossingPoint(pt, prev, clipPoly);
          current.push(crossing);
        }
      }
      current.push(pt);
    } else {
      // Exiting the polygon — find crossing point and close segment
      if (current.length > 0) {
        const lastInside = current[current.length - 1];
        const crossing = findCrossingPoint(lastInside, pt, clipPoly);
        current.push(crossing);
        if (current.length >= 2) {
          segments.push(current);
        }
        current = [];
      }
    }
  }

  // Flush remaining segment
  if (current.length >= 2) {
    segments.push(current);
  }

  return segments;
}

/**
 * Clip a GeoJSON FeatureCollection of LineStrings to the parcel boundary
 * plus a display buffer. Features that fall entirely outside are dropped.
 * Features that cross the boundary are split at the crossing.
 *
 * @param fc - FeatureCollection with LineString features
 * @param parcelGeometry - The parcel Polygon or MultiPolygon geometry
 * @param bufferMeters - Display buffer in meters (default 50)
 * @returns Clipped FeatureCollection
 */
export function clipLinesToParcel(
  fc: GeoJSON.FeatureCollection,
  parcelGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined,
  bufferMeters: number = DEFAULT_DISPLAY_BUFFER_M
): GeoJSON.FeatureCollection {
  // If no parcel geometry, return unmodified
  if (!parcelGeometry) return fc;
  if (!fc?.features?.length) return fc;

  try {
    // Build the clip polygon: parcel + buffer
    const parcelFeature = turf.feature(parcelGeometry);
    const buffered = turf.buffer(parcelFeature, bufferMeters / 1000, { units: 'kilometers' });
    if (!buffered) return fc;

    const clippedFeatures: GeoJSON.Feature[] = [];

    for (const feature of fc.features) {
      // Only clip LineStrings; pass through everything else
      if (feature.geometry?.type !== 'LineString') {
        clippedFeatures.push(feature);
        continue;
      }

      const coords = feature.geometry.coordinates as [number, number][];
      const segments = clipLineCoords(coords, buffered as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>);

      for (const seg of segments) {
        clippedFeatures.push({
          ...feature,
          geometry: {
            type: 'LineString',
            coordinates: seg,
          },
        });
      }
    }

    return {
      type: 'FeatureCollection',
      features: clippedFeatures,
    };
  } catch (err) {
    console.error('[clipLinesToParcel] Clipping failed (non-fatal), returning unclipped:', err);
    return fc;
  }
}
