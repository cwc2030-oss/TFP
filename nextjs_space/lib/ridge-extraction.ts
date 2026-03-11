/**
 * Terrain Spine / Backbone Extraction Utility
 * 
 * Structure-first approach: extracts the structural BACKBONE from terrain.
 * No deer weighting - pure topographical anatomy.
 * 
 * Goal: The Backbone should represent the HIGHEST CONTINUOUS RIDGE CREST
 * across the parcel — the actual topographic "backbone" a hunter would recognize.
 * 
 * CRITICAL RULES:
 * 1. Favor ridge CREST detection over valley/slope convergence
 *    - The algorithm should prioritize continuous local elevation maxima
 *    - Do NOT treat slope pinch / hourglass convergence as the Backbone
 * 
 * 2. Use ridge-LINE logic, not flow-convergence logic
 *    - Backbone should follow the structural HIGH ground
 *    - It should NOT follow narrowest slope points or valley pinch geometry
 * 
 * 3. CONSERVATIVE output rule
 *    - If ridge confidence is LOW, show NO Backbone rather than an incorrect one
 *    - Better no line than a misleading one
 * 
 * Acceptance test:
 * A hunter should toggle Backbone on and say: "Yep, that's the ridge."
 * If it looks like an hourglass, slope pinch, or valley convergence, it is WRONG.
 */

import type {
  RidgeSpineResponse,
  RidgeSpineProperties,
  SaddleNodeProperties,
  RidgeSpineMetadata,
  RidgeTier,
} from '@/types/terrain';

// ========== CONSERVATIVE THRESHOLDS FOR BACKBONE DETECTION ==========
// Higher thresholds = fewer but more confident ridges
const MIN_PROMINENCE_FT_PRIMARY = 45;     // Major drop on BOTH sides for primary backbone
const MIN_PROMINENCE_FT_SECONDARY = 35;   // Secondary still requires significant drop
const MIN_LENGTH_M_PRIMARY = 400;         // Long, continuous backbone (not short fragments)
const MIN_LENGTH_M_SECONDARY = 250;       // Secondary ridges also need length
const MAX_SEGMENT_GAP_M = 30;             // Tight gap tolerance for merging
const COLLINEARITY_THRESHOLD_DEG = 15;    // Strict bearing alignment for merging
const SADDLE_DROP_MIN_FT = 25;            // Only very pronounced saddles
const MIN_BACKBONE_CONFIDENCE = 0.6;      // Confidence threshold - below this, show nothing

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
  
  console.log('[Backbone] === FETCH START ===');
  console.log('[Backbone] Parcel ID:', params.parcel_id);
  console.log('[Backbone] Buffer:', params.bufferMeters ?? 400, 'm');
  
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
      console.warn('[Backbone] API error, falling back to empty state:', errorText);
      
      // Fall back to synthetic generation (returns empty for now)
      const syntheticData = generateSyntheticRidgeSpines(params.parcel);
      return {
        success: true,
        data: syntheticData,
        durationMs,
        isSynthetic: true,
      };
    }
    
    const data = await response.json();
    const primaryCount = data.ridges_primary?.features?.length || 0;
    const secondaryCount = data.ridges_secondary?.features?.length || 0;
    console.log('[Backbone] Response received:', {
      duration: durationMs + 'ms',
      primary: primaryCount,
      secondary: secondaryCount,
      dem_source: data.metadata?.dem_source || 'unknown',
    });
    
    return {
      success: true,
      data: data as RidgeSpineResponse,
      durationMs,
      isSynthetic: false,
    };
    
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn('[Backbone] Fetch failed, returning empty state:', errMsg);
    
    // Fall back to synthetic generation (returns empty - "Not detected")
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
 * Compute backbone confidence score
 * 
 * Without real DEM data, we cannot reliably determine true ridge crests.
 * This function estimates confidence based on parcel characteristics.
 * 
 * LOW confidence scenarios:
 * - Parcels too small to have meaningful ridges
 * - Parcels with irregular shapes that confuse geometry-based detection
 * - Without elevation data, we CANNOT distinguish ridge crests from valleys
 */
function computeBackboneConfidence(
  widthM: number,
  heightM: number,
  parcelAcres: number,
  aspectRatio: number,
  coords: number[][]
): { confidence: number; reason: string } {
  let confidence = 0;
  let reason = '';
  
  // Without DEM data, we have very low confidence in any backbone detection
  // The geometry-based approach tends to follow parcel shape, not terrain
  const BASE_SYNTHETIC_PENALTY = 0.4; // Major penalty for not having real elevation data
  
  confidence = 1.0 - BASE_SYNTHETIC_PENALTY;
  
  // Parcel size factor - larger parcels more likely to have meaningful ridges
  if (parcelAcres < 20) {
    confidence *= 0.3;
    reason = 'Parcel too small for confident backbone detection';
  } else if (parcelAcres < 40) {
    confidence *= 0.5;
    reason = 'Small parcel - backbone confidence limited';
  } else if (parcelAcres < 80) {
    confidence *= 0.7;
    reason = 'Medium parcel - moderate backbone confidence';
  } else {
    confidence *= 0.85;
    reason = 'Large parcel - better backbone confidence';
  }
  
  // Aspect ratio - very elongated parcels have lower confidence
  // (geometry-based detection follows parcel shape, not terrain)
  if (aspectRatio > 4 || aspectRatio < 0.25) {
    confidence *= 0.4;
    reason = 'Elongated parcel shape reduces backbone confidence';
  } else if (aspectRatio > 2.5 || aspectRatio < 0.4) {
    confidence *= 0.6;
    reason = 'Irregular aspect ratio - backbone may follow parcel shape not terrain';
  }
  
  // Shape complexity - irregular shapes are harder to interpret
  const expectedPerimeter = 4 * Math.sqrt(widthM * heightM);
  let actualPerimeter = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    actualPerimeter += distanceMeters(
      [coords[i][0], coords[i][1]] as [number, number],
      [coords[i + 1][0], coords[i + 1][1]] as [number, number]
    );
  }
  const perimeterRatio = actualPerimeter / expectedPerimeter;
  
  if (perimeterRatio > 1.8) {
    confidence *= 0.5;
    reason = 'Complex parcel boundary - backbone detection unreliable';
  } else if (perimeterRatio > 1.4) {
    confidence *= 0.7;
    reason = 'Irregular boundary affects backbone confidence';
  }
  
  // Final clamp
  confidence = Math.max(0, Math.min(1, confidence));
  
  // Critical: without real DEM, confidence should never be high
  if (confidence > 0.6) {
    confidence = 0.55; // Cap synthetic confidence below threshold
    reason = 'Synthetic backbone - awaiting real DEM data for accurate ridge detection';
  }
  
  return { confidence, reason };
}

/**
 * Generate backbone data for parcels
 * 
 * CONSERVATIVE APPROACH:
 * - Without real DEM data, we CANNOT reliably detect ridge crests
 * - The previous geometry-based approach created misleading hourglass shapes
 * - Following the principle: "Better no line than a misleading one"
 * 
 * This function now returns EMPTY results for synthetic generation
 * until real DEM-based ridge detection is available.
 * 
 * Acceptance test:
 * A hunter should toggle Backbone on and say: "Yep, that's the ridge."
 * If no backbone shows, that's better than showing a wrong one.
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
  
  // Calculate parcel dimensions
  const widthM = distanceMeters([bbox[0], centerLat], [bbox[2], centerLat]);
  const heightM = distanceMeters([centerLng, bbox[1]], [centerLng, bbox[3]]);
  const parcelAreaSqM = widthM * heightM * 0.8; // Rough estimate
  const parcelAcres = parcelAreaSqM / 4046.86;
  const aspectRatio = widthM / heightM;
  
  console.log('[Backbone] Parcel ~', Math.round(parcelAcres), 'acres, w:', Math.round(widthM), 'm, h:', Math.round(heightM), 'm');
  
  // Compute confidence score
  const { confidence, reason } = computeBackboneConfidence(
    widthM, heightM, parcelAcres, aspectRatio, coords
  );
  
  console.log('[Backbone] Confidence:', (confidence * 100).toFixed(1) + '%', '-', reason);
  
  // CONSERVATIVE RULE: If confidence is below threshold, show NO backbone
  // "Better no line than a misleading one"
  if (confidence < MIN_BACKBONE_CONFIDENCE) {
    console.log('[Backbone] Confidence too low (' + (confidence * 100).toFixed(1) + '% < ' + (MIN_BACKBONE_CONFIDENCE * 100) + '%), returning empty');
    return emptyRidgeResponse(
      `Backbone confidence too low (${(confidence * 100).toFixed(0)}%). ` +
      `Real DEM-based ridge detection required for reliable backbone. ` +
      `${reason}`
    );
  }
  
  // If we reach here with synthetic data, we still shouldn't generate
  // because geometry-based detection creates misleading hourglass shapes
  // that follow parcel boundaries, not actual ridge crests
  console.log('[Backbone] Synthetic mode - returning empty (awaiting real DEM)');
  
  const processingTime = (Date.now() - startTime) / 1000;
  
  return {
    success: true,
    bbox,
    ridges_primary: { type: 'FeatureCollection', features: [] },
    ridges_secondary: { type: 'FeatureCollection', features: [] },
    saddle_nodes: { type: 'FeatureCollection', features: [] },
    metadata: {
      processing_time_seconds: processingTime,
      dem_source: 'AWAITING_DEM',
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
      backbone_confidence: confidence,
      fallback_reason: 
        'Backbone detection paused. ' +
        'Synthetic (geometry-based) detection produced misleading results ' +
        '(hourglass/slope-convergence shapes instead of true ridge crests). ' +
        'Real DEM-based ridge extraction required for accurate backbone display. ' +
        reason,
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
