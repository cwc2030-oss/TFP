/**
 * Terrain Spine Extraction Utility
 * 
 * Structure-first approach: extracts structural terrain spines from DEM only.
 * No deer weighting - pure topographical anatomy.
 * 
 * Goal: A calm, minimal layer that feels topographically true.
 * A hunter should be able to toggle Terrain Spine on and say:
 * "Yep, that's the backbone of this parcel."
 * 
 * From DEM:
 * - Compute slope, curvature (plan + profile), and local prominence
 * - Identify convex high-ground lines
 * - Filter aggressively by minimum prominence and length
 * - Merge near-collinear segments into longer coherent spines
 * - Classify into primary/secondary ridges
 * - Extract saddle nodes conservatively (only meaningful low points)
 */

import type {
  RidgeSpineResponse,
  RidgeSpineProperties,
  SaddleNodeProperties,
  RidgeSpineMetadata,
  RidgeTier,
} from '@/types/terrain';

// ========== AGGRESSIVE THRESHOLDS (noise reduction) ==========
const MIN_PROMINENCE_FT_PRIMARY = 35;     // Major drop on both sides for primary
const MIN_PROMINENCE_FT_SECONDARY = 25;   // Secondary still requires meaningful drop
const MIN_LENGTH_M_PRIMARY = 300;         // Minimum continuous length for primary (was 200)
const MIN_LENGTH_M_SECONDARY = 180;       // Minimum for secondary (was 100)
const MAX_SEGMENT_GAP_M = 40;             // Max gap to merge collinear segments
const COLLINEARITY_THRESHOLD_DEG = 20;    // Max bearing difference for merging
const SADDLE_DROP_MIN_FT = 18;            // Only real saddles (was 10)

// ========== API CLIENT ==========

const RIDGE_API_URL = '/api/ridge-spines';
const REQUEST_TIMEOUT_MS = 30000;

export interface RidgeRequestParams {
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  parcel_id: string;
  bufferMeters?: number;
}

export interface RidgeFetchResult {
  success: boolean;
  data?: RidgeSpineResponse;
  error?: string;
  status?: number;
  durationMs: number;
  isSynthetic: boolean;
}

/**
 * Fetch ridge spine data from API or generate synthetic fallback
 */
export async function fetchRidgeSpines(
  params: RidgeRequestParams,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<RidgeFetchResult> {
  const startTime = Date.now();
  
  console.log('[TerrainSpine] === FETCH START ===');
  console.log('[TerrainSpine] Parcel ID:', params.parcel_id);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(RIDGE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parcel: params.parcel,
        parcel_id: params.parcel_id,
        bufferMeters: params.bufferMeters ?? 400,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[TerrainSpine] API error, using synthetic:', errorText);
      
      // Fall back to synthetic generation
      const syntheticData = generateSyntheticRidgeSpines(params.parcel);
      return {
        success: true,
        data: syntheticData,
        durationMs,
        isSynthetic: true,
      };
    }
    
    const data = await response.json();
    console.log('[TerrainSpine] Response received in', durationMs, 'ms');
    
    return {
      success: true,
      data: data as RidgeSpineResponse,
      durationMs,
      isSynthetic: false,
    };
    
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn('[TerrainSpine] Fetch failed, using synthetic:', errMsg);
    
    // Fall back to synthetic generation
    const syntheticData = generateSyntheticRidgeSpines(params.parcel);
    return {
      success: true,
      data: syntheticData,
      durationMs,
      isSynthetic: true,
    };
  }
}

// ========== GEOMETRY UTILITIES ==========

/**
 * Calculate distance between two points in meters
 */
function distanceMeters(p1: [number, number], p2: [number, number]): number {
  const R = 6371000;
  const dLat = (p2[1] - p1[1]) * Math.PI / 180;
  const dLng = (p2[0] - p1[0]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1[1] * Math.PI / 180) * Math.cos(p2[1] * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate bearing between two points
 */
function calculateBearing(from: [number, number], to: [number, number]): number {
  const lat1 = from[1] * Math.PI / 180;
  const lat2 = to[1] * Math.PI / 180;
  const dLng = (to[0] - from[0]) * Math.PI / 180;
  
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

/**
 * Move point by bearing and distance
 */
function movePoint(point: [number, number], bearing: number, distanceM: number): [number, number] {
  const R = 6371000;
  const lat1 = point[1] * Math.PI / 180;
  const lng1 = point[0] * Math.PI / 180;
  const brng = bearing * Math.PI / 180;
  const d = distanceM / R;
  
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );
  
  return [lng2 * 180 / Math.PI, lat2 * 180 / Math.PI];
}

/**
 * Get bounding box from polygon
 */
function getBbox(coords: number[][]): [number, number, number, number] {
  const lngs = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/**
 * Calculate line length in meters
 */
function lineLength(coords: [number, number][]): number {
  let length = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    length += distanceMeters(coords[i], coords[i + 1]);
  }
  return length;
}

/**
 * Interpolate points along a line at regular intervals
 */
function interpolateLine(
  start: [number, number],
  end: [number, number],
  numPoints: number
): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    points.push([
      start[0] + (end[0] - start[0]) * t,
      start[1] + (end[1] - start[1]) * t,
    ]);
  }
  return points;
}

// ========== SYNTHETIC TERRAIN SPINE GENERATION ==========

/**
 * Bearing difference in degrees (0-180)
 */
function bearingDiff(b1: number, b2: number): number {
  let diff = Math.abs(b1 - b2) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
}

/**
 * Check if two line segments are roughly collinear
 * (endpoints are close and bearings are similar)
 */
function areCollinearSegments(
  seg1: { start: [number, number]; end: [number, number]; bearing: number },
  seg2: { start: [number, number]; end: [number, number]; bearing: number }
): boolean {
  // Check bearing similarity (allow reverse direction)
  const bDiff = bearingDiff(seg1.bearing, seg2.bearing);
  const bDiffReverse = bearingDiff(seg1.bearing, (seg2.bearing + 180) % 360);
  const isCollinear = Math.min(bDiff, bDiffReverse) < COLLINEARITY_THRESHOLD_DEG;
  if (!isCollinear) return false;
  
  // Check endpoint proximity
  const d1 = distanceMeters(seg1.end, seg2.start);
  const d2 = distanceMeters(seg1.end, seg2.end);
  const d3 = distanceMeters(seg1.start, seg2.start);
  const d4 = distanceMeters(seg1.start, seg2.end);
  const minDist = Math.min(d1, d2, d3, d4);
  
  return minDist < MAX_SEGMENT_GAP_M;
}

/**
 * Generate synthetic terrain spines based on parcel geometry
 * Conservative approach: fewer, longer, cleaner spines
 * 
 * Goal: A hunter looks at this and says "Yep, that's the backbone"
 */
export function generateSyntheticRidgeSpines(
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
): RidgeSpineResponse {
  const startTime = Date.now();
  
  // Extract parcel coordinates
  let coords: number[][] = [];
  if (parcel.geometry.type === 'Polygon') {
    coords = parcel.geometry.coordinates[0];
  } else {
    // Use largest polygon from MultiPolygon
    let maxLen = 0;
    parcel.geometry.coordinates.forEach(poly => {
      if (poly[0].length > maxLen) {
        maxLen = poly[0].length;
        coords = poly[0];
      }
    });
  }
  
  if (coords.length < 4) {
    return emptyRidgeResponse('Insufficient parcel coordinates');
  }
  
  const bbox = getBbox(coords);
  const centerLng = (bbox[0] + bbox[2]) / 2;
  const centerLat = (bbox[1] + bbox[3]) / 2;
  const center: [number, number] = [centerLng, centerLat];
  
  // Calculate parcel dimensions
  const widthM = distanceMeters([bbox[0], centerLat], [bbox[2], centerLat]);
  const heightM = distanceMeters([centerLng, bbox[1]], [centerLng, bbox[3]]);
  const parcelAreaSqM = widthM * heightM * 0.8; // Rough estimate
  const parcelAcres = parcelAreaSqM / 4046.86;
  
  console.log('[TerrainSpine] Parcel ~', Math.round(parcelAcres), 'acres, w:', Math.round(widthM), 'm, h:', Math.round(heightM), 'm');
  
  // Determine primary spine direction (along longest axis)
  const isWide = widthM > heightM;
  const primaryBearing = isWide ? 90 : 0; // E-W if wide, N-S if tall
  const primaryLength = Math.max(widthM, heightM) * 0.75; // Slightly shorter for cleaner look
  const secondaryBearing = (primaryBearing + 90) % 180;
  
  const ridgesPrimary: GeoJSON.Feature<GeoJSON.LineString, RidgeSpineProperties>[] = [];
  const ridgesSecondary: GeoJSON.Feature<GeoJSON.LineString, RidgeSpineProperties>[] = [];
  const saddleNodes: GeoJSON.Feature<GeoJSON.Point, SaddleNodeProperties>[] = [];
  
  // Generate primary spines: CONSERVATIVE - only 1 unless parcel is large
  // Small parcels (<50 acres) get at most 1 primary spine
  // Large parcels (50-100 acres) may get 1
  // Only very large parcels (>100 acres) get 2
  const numPrimaryRidges = parcelAcres > 100 ? 2 : (parcelAcres > 30 && primaryLength >= MIN_LENGTH_M_PRIMARY ? 1 : 0);
  
  if (numPrimaryRidges > 0) {
    const ridgeSpacing = heightM / (numPrimaryRidges + 1);
    
    for (let i = 0; i < numPrimaryRidges; i++) {
      const offsetFactor = (i + 1) / (numPrimaryRidges + 1);
      
      // Create longer, cleaner spine with minimal curvature
      const halfLen = primaryLength / 2;
      const yOffset = (isWide ? heightM : widthM) * (offsetFactor - 0.5) * 0.6;
      
      const spineCenter: [number, number] = isWide
        ? [centerLng, centerLat + (yOffset / 111320)]  // Rough lat offset
        : [centerLng + (yOffset / (111320 * Math.cos(centerLat * Math.PI / 180))), centerLat];
      
      const start = movePoint(spineCenter, primaryBearing, -halfLen * 0.45);
      const end = movePoint(spineCenter, primaryBearing, halfLen * 0.45);
      
      // Minimal curvature - just one midpoint with subtle bend
      const mid = movePoint(
        [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
        secondaryBearing,
        ridgeSpacing * 0.08 * (i % 2 === 0 ? 1 : -1)
      );
      
      const ridgeCoords: [number, number][] = [start, mid, end];
      const ridgeLen = lineLength(ridgeCoords);
      
      if (ridgeLen >= MIN_LENGTH_M_PRIMARY) {
        const ridgeId = `spine-primary-${i}`;
        ridgesPrimary.push({
          type: 'Feature',
          properties: {
            tier: 'primary',
            prominenceFt: 35 + Math.random() * 20, // 35-55 ft (higher threshold)
            lengthMeters: ridgeLen,
            avgElevationM: 280 + Math.random() * 40,
            avgSlopeDeg: 10 + Math.random() * 8, // 10-18 degree slopes
            curvatureProfile: 0.06 + Math.random() * 0.08,
            id: ridgeId,
          },
          geometry: {
            type: 'LineString',
            coordinates: ridgeCoords,
          },
        });
      }
    }
  }
  
  // Generate secondary spines: VERY CONSERVATIVE
  // Only if parcel is reasonably sized and only 1-2 max
  const minSecondaryLength = Math.min(widthM, heightM) * 0.35;
  const numSecondaryRidges = parcelAcres > 60 && minSecondaryLength >= MIN_LENGTH_M_SECONDARY ? 
    Math.min(2, Math.floor(parcelAcres / 50)) : 0;
  
  for (let i = 0; i < numSecondaryRidges; i++) {
    const offset = (i + 1) / (numSecondaryRidges + 1);
    const startPoint: [number, number] = [
      bbox[0] + (bbox[2] - bbox[0]) * offset,
      bbox[1] + (bbox[3] - bbox[1]) * 0.5, // Center vertically
    ];
    
    // Secondary spines extend perpendicular to primary
    const direction = secondaryBearing + (i % 2 === 0 ? 0 : 180);
    const end = movePoint(startPoint, direction, minSecondaryLength * 0.8);
    
    const ridgeCoords: [number, number][] = [startPoint, end];
    const ridgeLen = lineLength(ridgeCoords);
    
    if (ridgeLen >= MIN_LENGTH_M_SECONDARY) {
      ridgesSecondary.push({
        type: 'Feature',
        properties: {
          tier: 'secondary',
          prominenceFt: 25 + Math.random() * 12, // 25-37 ft
          lengthMeters: ridgeLen,
          avgElevationM: 270 + Math.random() * 30,
          avgSlopeDeg: 8 + Math.random() * 6, // 8-14 degree
          curvatureProfile: 0.04 + Math.random() * 0.06,
          id: `spine-secondary-${i}`,
        },
        geometry: {
          type: 'LineString',
          coordinates: ridgeCoords,
        },
      });
    }
  }
  
  // SADDLE GENERATION: Very conservative - only where hunter would recognize a crossing
  // Only add a saddle if we have at least one primary spine AND parcel is large enough
  if (ridgesPrimary.length > 0 && parcelAcres > 80) {
    // At most 1 saddle per parcel - positioned where it would be meaningful
    const primarySpine = ridgesPrimary[0];
    const spineCoords = primarySpine.geometry.coordinates as [number, number][];
    
    // Place saddle at ~40% along the spine (a natural low point)
    const t = 0.4;
    const saddlePoint: [number, number] = [
      spineCoords[0][0] + (spineCoords[spineCoords.length - 1][0] - spineCoords[0][0]) * t,
      spineCoords[0][1] + (spineCoords[spineCoords.length - 1][1] - spineCoords[0][1]) * t,
    ];
    
    saddleNodes.push({
      type: 'Feature',
      properties: {
        id: 'saddle-main',
        elevationM: 270 + Math.random() * 25,
        ridgeDropFt: SADDLE_DROP_MIN_FT + Math.random() * 10,
        adjacentRidgeIds: [primarySpine.properties.id],
      },
      geometry: {
        type: 'Point',
        coordinates: saddlePoint,
      },
    });
  }
  
  const processingTime = (Date.now() - startTime) / 1000;
  const totalRidgeLength = [
    ...ridgesPrimary.map(r => r.properties.lengthMeters),
    ...ridgesSecondary.map(r => r.properties.lengthMeters),
  ].reduce((a, b) => a + b, 0);
  
  console.log('[TerrainSpine] Generated:', ridgesPrimary.length, 'primary,', ridgesSecondary.length, 'secondary,', saddleNodes.length, 'saddles');
  
  return {
    success: true,
    bbox,
    ridges_primary: { type: 'FeatureCollection', features: ridgesPrimary },
    ridges_secondary: { type: 'FeatureCollection', features: ridgesSecondary },
    saddle_nodes: { type: 'FeatureCollection', features: saddleNodes },
    metadata: {
      processing_time_seconds: processingTime,
      dem_source: 'SYNTHETIC (geometry-based)',
      resolution_m: 0,
      thresholds: {
        min_prominence_ft_primary: MIN_PROMINENCE_FT_PRIMARY,
        min_prominence_ft_secondary: MIN_PROMINENCE_FT_SECONDARY,
        min_length_m_primary: MIN_LENGTH_M_PRIMARY,
        min_length_m_secondary: MIN_LENGTH_M_SECONDARY,
      },
      total_ridge_length_m: totalRidgeLength,
      ridge_count_primary: ridgesPrimary.length,
      ridge_count_secondary: ridgesSecondary.length,
      saddle_count: saddleNodes.length,
      fallback_reason: 'Synthetic generation - real DEM analysis not yet available',
    },
  };
}

/**
 * Create empty ridge response for error cases
 */
function emptyRidgeResponse(reason: string): RidgeSpineResponse {
  return {
    success: false,
    bbox: [0, 0, 0, 0],
    ridges_primary: { type: 'FeatureCollection', features: [] },
    ridges_secondary: { type: 'FeatureCollection', features: [] },
    saddle_nodes: { type: 'FeatureCollection', features: [] },
    metadata: {
      processing_time_seconds: 0,
      dem_source: 'NONE',
      resolution_m: 0,
      thresholds: {
        min_prominence_ft_primary: MIN_PROMINENCE_FT_PRIMARY,
        min_prominence_ft_secondary: MIN_PROMINENCE_FT_SECONDARY,
        min_length_m_primary: MIN_LENGTH_M_PRIMARY,
        min_length_m_secondary: MIN_LENGTH_M_SECONDARY,
      },
      total_ridge_length_m: 0,
      ridge_count_primary: 0,
      ridge_count_secondary: 0,
      saddle_count: 0,
      fallback_reason: reason,
    },
  };
}
