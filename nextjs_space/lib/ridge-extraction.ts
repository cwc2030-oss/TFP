/**
 * Ridge Spine Extraction Utility
 * 
 * Structure-first approach: extracts structural ridge spines from DEM only.
 * No deer weighting - pure terrain anatomy.
 * 
 * From DEM:
 * - Compute slope, curvature (plan + profile), and local prominence
 * - Identify convex high-ground lines
 * - Filter by minimum prominence (>20 ft) and length (>200m)
 * - Classify into primary/secondary ridges
 * - Extract saddle nodes between ridge peaks
 */

import type {
  RidgeSpineResponse,
  RidgeSpineProperties,
  SaddleNodeProperties,
  RidgeSpineMetadata,
  RidgeTier,
} from '@/types/terrain';

// ========== THRESHOLDS ==========
const MIN_PROMINENCE_FT_PRIMARY = 20;     // Minimum drop on both sides for primary
const MIN_PROMINENCE_FT_SECONDARY = 15;   // Minimum for secondary
const MIN_LENGTH_M_PRIMARY = 200;         // Minimum continuous length for primary
const MIN_LENGTH_M_SECONDARY = 100;       // Minimum for secondary
const MAX_SEGMENT_GAP_M = 30;             // Max gap to connect ridge segments
const SADDLE_DROP_MIN_FT = 10;            // Minimum drop for saddle identification

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
  
  console.log('[RidgeClient] === FETCH START ===');
  console.log('[RidgeClient] Parcel ID:', params.parcel_id);
  
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
      console.warn('[RidgeClient] API error, using synthetic:', errorText);
      
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
    console.log('[RidgeClient] Response received in', durationMs, 'ms');
    
    return {
      success: true,
      data: data as RidgeSpineResponse,
      durationMs,
      isSynthetic: false,
    };
    
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn('[RidgeClient] Fetch failed, using synthetic:', errMsg);
    
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

// ========== SYNTHETIC RIDGE GENERATION ==========

/**
 * Generate synthetic ridge spines based on parcel geometry
 * Uses geometric analysis to simulate ridge lines:
 * - Creates ridges along longest axis of parcel
 * - Adds secondary ridges perpendicular to main ridge
 * - Places saddle points at intersections and low points
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
  
  console.log('[RidgeSynthetic] Parcel ~', Math.round(parcelAcres), 'acres, w:', Math.round(widthM), 'm, h:', Math.round(heightM), 'm');
  
  // Determine primary ridge direction (along longest axis)
  const isWide = widthM > heightM;
  const primaryBearing = isWide ? 90 : 0; // E-W if wide, N-S if tall
  const primaryLength = Math.max(widthM, heightM) * 0.8;
  const secondaryBearing = (primaryBearing + 90) % 180;
  
  const ridgesPrimary: GeoJSON.Feature<GeoJSON.LineString, RidgeSpineProperties>[] = [];
  const ridgesSecondary: GeoJSON.Feature<GeoJSON.LineString, RidgeSpineProperties>[] = [];
  const saddleNodes: GeoJSON.Feature<GeoJSON.Point, SaddleNodeProperties>[] = [];
  
  // Generate 1-2 primary ridges based on parcel size
  const numPrimaryRidges = parcelAcres > 40 ? 2 : 1;
  const ridgeSpacing = heightM / (numPrimaryRidges + 1);
  
  for (let i = 0; i < numPrimaryRidges; i++) {
    const offsetFactor = (i + 1) / (numPrimaryRidges + 1);
    const ridgeCenter = movePoint(
      [bbox[0], bbox[1]],
      isWide ? 0 : 90,
      (isWide ? heightM : widthM) * offsetFactor
    );
    ridgeCenter[0] = centerLng; // Align to center
    
    // Create ridge line with some variation
    const halfLen = primaryLength / 2;
    const start = movePoint(center, primaryBearing, -halfLen * 0.4 + (i * 0.1 * halfLen));
    const end = movePoint(center, primaryBearing, halfLen * 0.4 + (i * 0.1 * halfLen));
    
    // Add some natural curvature
    const midpoint1 = movePoint(
      [start[0] + (end[0] - start[0]) * 0.33, start[1] + (end[1] - start[1]) * 0.33],
      secondaryBearing,
      ridgeSpacing * 0.15 * (i % 2 === 0 ? 1 : -1)
    );
    const midpoint2 = movePoint(
      [start[0] + (end[0] - start[0]) * 0.66, start[1] + (end[1] - start[1]) * 0.66],
      secondaryBearing,
      ridgeSpacing * 0.1 * (i % 2 === 0 ? -1 : 1)
    );
    
    const ridgeCoords: [number, number][] = [start, midpoint1, midpoint2, end];
    const ridgeLen = lineLength(ridgeCoords);
    
    if (ridgeLen >= MIN_LENGTH_M_PRIMARY) {
      const ridgeId = `ridge-primary-${i}`;
      ridgesPrimary.push({
        type: 'Feature',
        properties: {
          tier: 'primary',
          prominenceFt: 25 + Math.random() * 15, // 25-40 ft synthetic prominence
          lengthMeters: ridgeLen,
          avgElevationM: 280 + Math.random() * 40, // Synthetic elevation
          avgSlopeDeg: 8 + Math.random() * 7, // 8-15 degree slopes
          curvatureProfile: 0.05 + Math.random() * 0.1, // Convex curvature
          id: ridgeId,
        },
        geometry: {
          type: 'LineString',
          coordinates: ridgeCoords,
        },
      });
      
      // Add saddle at low point (roughly 1/3 along ridge)
      const saddlePoint: [number, number] = [
        start[0] + (end[0] - start[0]) * (0.3 + Math.random() * 0.2),
        start[1] + (end[1] - start[1]) * (0.3 + Math.random() * 0.2),
      ];
      saddleNodes.push({
        type: 'Feature',
        properties: {
          id: `saddle-${i}`,
          elevationM: 275 + Math.random() * 30,
          ridgeDropFt: 12 + Math.random() * 8,
          adjacentRidgeIds: [ridgeId],
        },
        geometry: {
          type: 'Point',
          coordinates: saddlePoint,
        },
      });
    }
  }
  
  // Generate 2-4 secondary ridges (perpendicular spurs)
  const numSecondaryRidges = Math.min(4, Math.floor(parcelAcres / 20) + 1);
  const secondaryLength = Math.min(widthM, heightM) * 0.4;
  
  for (let i = 0; i < numSecondaryRidges; i++) {
    const offset = (i + 1) / (numSecondaryRidges + 1);
    const startPoint: [number, number] = [
      bbox[0] + (bbox[2] - bbox[0]) * offset,
      bbox[1] + (bbox[3] - bbox[1]) * (0.3 + Math.random() * 0.4),
    ];
    
    // Secondary ridges extend perpendicular to primary
    const direction = secondaryBearing + (Math.random() > 0.5 ? 0 : 180);
    const end = movePoint(startPoint, direction, secondaryLength * (0.6 + Math.random() * 0.4));
    
    const ridgeCoords: [number, number][] = [startPoint, end];
    const ridgeLen = lineLength(ridgeCoords);
    
    if (ridgeLen >= MIN_LENGTH_M_SECONDARY) {
      ridgesSecondary.push({
        type: 'Feature',
        properties: {
          tier: 'secondary',
          prominenceFt: 15 + Math.random() * 10, // 15-25 ft
          lengthMeters: ridgeLen,
          avgElevationM: 270 + Math.random() * 30,
          avgSlopeDeg: 6 + Math.random() * 6, // 6-12 degree
          curvatureProfile: 0.03 + Math.random() * 0.07,
          id: `ridge-secondary-${i}`,
        },
        geometry: {
          type: 'LineString',
          coordinates: ridgeCoords,
        },
      });
    }
  }
  
  const processingTime = (Date.now() - startTime) / 1000;
  const totalRidgeLength = [
    ...ridgesPrimary.map(r => r.properties.lengthMeters),
    ...ridgesSecondary.map(r => r.properties.lengthMeters),
  ].reduce((a, b) => a + b, 0);
  
  console.log('[RidgeSynthetic] Generated:', ridgesPrimary.length, 'primary,', ridgesSecondary.length, 'secondary,', saddleNodes.length, 'saddles');
  
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
