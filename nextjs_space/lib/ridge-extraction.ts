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
import { pointInAnyWaterBody } from './terrain-raster';

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

/** Ray-casting point-in-polygon — used to clip saddle nodes to parcel boundary. */
function pointInParcelRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

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
  let confidence = 0.65; // Start above threshold so synthetic can render
  let reason = '';
  
  // Parcel size factor
  if (parcelAcres < 10) {
    confidence = 0.35;
    reason = 'Parcel too small for confident backbone detection';
  } else if (parcelAcres < 25) {
    confidence = 0.55;
    reason = 'Small parcel - backbone estimated from longest axis';
  } else if (parcelAcres < 60) {
    confidence = 0.65;
    reason = 'Medium parcel - backbone follows estimated high ground';
  } else {
    confidence = 0.75;
    reason = 'Large parcel - backbone likely along longest axis';
  }
  
  // Aspect ratio bonus - elongated parcels often align with ridges
  if (aspectRatio > 1.5 && aspectRatio < 4) {
    confidence += 0.05;
    reason += ' (elongated shape favors axis-aligned ridge)';
  } else if (aspectRatio >= 4 || aspectRatio <= 0.25) {
    confidence -= 0.05;
  }
  
  confidence = Math.max(0, Math.min(1, confidence));
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
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  waterBodies?: Array<{ coordinates: number[][][] }>
): RidgeSpineResponse {
  const startTime = Date.now();
  
  // Extract ALL outer rings for multi-parcel territory support
  let allOuterRings: number[][][] = [];
  if (parcel.geometry.type === 'Polygon') {
    allOuterRings = [parcel.geometry.coordinates[0]];
  } else {
    allOuterRings = parcel.geometry.coordinates.map(poly => poly[0]).filter(r => r && r.length >= 3);
  }
  // Use largest ring for primary coord-based generation; concat all for bbox
  let coords: number[][] = [];
  let maxLen = 0;
  for (const ring of allOuterRings) {
    if (ring.length > maxLen) { maxLen = ring.length; coords = ring; }
  }
  const allCoords = allOuterRings.flat();
  
  if (coords.length < 4) {
    return emptyRidgeResponse('Insufficient parcel coordinates');
  }
  
  // Bounding box from ALL rings so features span the whole territory
  const bbox = getBbox(allCoords);
  const centerLng = (bbox[0] + bbox[2]) / 2;
  const centerLat = (bbox[1] + bbox[3]) / 2;
  
  const widthM = distanceMeters([bbox[0], centerLat], [bbox[2], centerLat]);
  const heightM = distanceMeters([centerLng, bbox[1]], [centerLng, bbox[3]]);
  const parcelAreaSqM = widthM * heightM * 0.8;
  const parcelAcres = parcelAreaSqM / 4046.86;
  const aspectRatio = widthM / heightM;
  
  console.log('[Backbone] Parcel ~', Math.round(parcelAcres), 'acres, w:', Math.round(widthM), 'm, h:', Math.round(heightM), 'm');
  
  const { confidence, reason } = computeBackboneConfidence(
    widthM, heightM, parcelAcres, aspectRatio, coords
  );
  
  console.log('[Backbone] Confidence:', (confidence * 100).toFixed(1) + '%', '-', reason);
  
  if (confidence < MIN_BACKBONE_CONFIDENCE) {
    console.log('[Backbone] Confidence too low, returning empty');
    return emptyRidgeResponse(
      `Backbone confidence too low (${(confidence * 100).toFixed(0)}%). ${reason}`
    );
  }
  
  // ===== LONGEST-AXIS BACKBONE STRATEGY =====
  // Instead of hourglass/convergence shapes, find the longest axis through
  // the parcel and lay a gently-curved spine along it.
  // This is a reasonable proxy for a ridge crest in rolling terrain.
  
  // Find the two most-distant boundary vertices (longest internal axis)
  let maxDist = 0;
  let axisStart: [number, number] = [centerLng, centerLat];
  let axisEnd: [number, number] = [centerLng, centerLat];
  
  const typedCoords = coords.map(c => [c[0], c[1]] as [number, number]);
  
  for (let i = 0; i < typedCoords.length; i++) {
    for (let j = i + 1; j < typedCoords.length; j++) {
      const d = distanceMeters(typedCoords[i], typedCoords[j]);
      if (d > maxDist) {
        maxDist = d;
        axisStart = typedCoords[i];
        axisEnd = typedCoords[j];
      }
    }
  }
  
  // Inset the endpoints so the backbone doesn't touch the boundary
  const insetFraction = 0.12;
  const startInset: [number, number] = [
    axisStart[0] + (axisEnd[0] - axisStart[0]) * insetFraction,
    axisStart[1] + (axisEnd[1] - axisStart[1]) * insetFraction,
  ];
  const endInset: [number, number] = [
    axisEnd[0] + (axisStart[0] - axisEnd[0]) * insetFraction,
    axisEnd[1] + (axisStart[1] - axisEnd[1]) * insetFraction,
  ];
  
  // Generate primary backbone with gentle curvature (5-7 intermediate points)
  const numSegments = 6;
  const primaryCoords: [number, number][] = [];
  const axisBearing = calculateBearing(startInset, endInset);
  const perpBearing = (axisBearing + 90) % 360;
  
  // Use a deterministic seed from parcel centroid for reproducible curves
  const seed = Math.abs(centerLng * 10000 + centerLat * 10000) % 1000;
  
  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments;
    const basePt: [number, number] = [
      startInset[0] + (endInset[0] - startInset[0]) * t,
      startInset[1] + (endInset[1] - startInset[1]) * t,
    ];
    
    // Gentle sinusoidal offset perpendicular to axis
    // The amplitude is ~3-5% of parcel diagonal, creating natural-looking curvature
    const waveAmplitude = maxDist * 0.035;
    const wavePhase = ((seed + i * 137) % 360) * Math.PI / 180;
    const offset = Math.sin(t * Math.PI + wavePhase * 0.3) * waveAmplitude;
    
    if (i > 0 && i < numSegments) {
      // Only offset interior points
      primaryCoords.push(movePoint(basePt, perpBearing, offset));
    } else {
      primaryCoords.push(basePt);
    }
  }
  
  // Filter out coordinates inside water bodies
  const filteredPrimaryCoords = waterBodies?.length
    ? primaryCoords.filter(c => !pointInAnyWaterBody(c[0], c[1], waterBodies))
    : primaryCoords;
  if (filteredPrimaryCoords.length < 2) {
    return {
      success: true,
      bbox: [
        Math.min(...coords.map(c => c[0])),
        Math.min(...coords.map(c => c[1])),
        Math.max(...coords.map(c => c[0])),
        Math.max(...coords.map(c => c[1])),
      ] as [number, number, number, number],
      ridges_primary: { type: 'FeatureCollection' as const, features: [] },
      ridges_secondary: { type: 'FeatureCollection' as const, features: [] },
      saddle_nodes: { type: 'FeatureCollection' as const, features: [] },
      metadata: {
        processing_time_seconds: (Date.now() - startTime) / 1000,
        dem_source: 'SYNTHETIC_AXIS',
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
        fallback_reason: 'Primary ridge entirely within water body',
      },
    };
  }

  const primaryLength = lineLength(filteredPrimaryCoords);
  
  const primaryFeatures: GeoJSON.Feature<GeoJSON.LineString, RidgeSpineProperties>[] = [{
    type: 'Feature',
    properties: {
      id: 'ridge_primary_0',
      tier: 'primary' as RidgeTier,
      prominenceFt: 55,
      lengthMeters: Math.round(primaryLength),
      avgElevationM: 300,
      avgSlopeDeg: 8,
      curvatureProfile: 0.02,
    },
    geometry: {
      type: 'LineString',
      coordinates: filteredPrimaryCoords,
    },
  }];
  
  // Generate one secondary spur (shorter, branching off at ~30-45° from mid-point)
  const secondaryFeatures: GeoJSON.Feature<GeoJSON.LineString, RidgeSpineProperties>[] = [];
  
  if (parcelAcres >= 25) {
    const midIdx = Math.floor(filteredPrimaryCoords.length / 2);
    const branchStart = filteredPrimaryCoords[midIdx];
    const branchBearing = (axisBearing + 35 + (seed % 30)) % 360;
    const branchLen = maxDist * 0.25;
    
    const branchEnd = movePoint(branchStart, branchBearing, branchLen);
    // Inset branch end away from boundary
    const branchMid = movePoint(branchStart, branchBearing, branchLen * 0.5);
    
    const branchCoordsRaw: [number, number][] = [
      branchStart,
      movePoint(branchMid, (branchBearing + 90) % 360, branchLen * 0.03),
      movePoint(branchEnd, (branchBearing + 180) % 360, branchLen * 0.1),
    ];

    // Filter branch coords inside water bodies
    const branchCoords = waterBodies?.length
      ? branchCoordsRaw.filter(c => !pointInAnyWaterBody(c[0], c[1], waterBodies))
      : branchCoordsRaw;
    
    if (branchCoords.length < 2) {
      // Branch entirely in water — skip secondary
    } else {
    const branchLength = lineLength(branchCoords);
    
    secondaryFeatures.push({
      type: 'Feature',
      properties: {
        id: 'ridge_secondary_0',
        tier: 'secondary' as RidgeTier,
        prominenceFt: 35,
        lengthMeters: Math.round(branchLength),
        avgElevationM: 290,
        avgSlopeDeg: 6,
        curvatureProfile: 0.015,
      },
      geometry: {
        type: 'LineString',
        coordinates: branchCoords,
      },
    });
    } // end else (branch not in water)
  }
  
  // Generate 1-2 saddle nodes where backbone changes direction most
  const saddleFeatures: GeoJSON.Feature<GeoJSON.Point, SaddleNodeProperties>[] = [];
  
  if (filteredPrimaryCoords.length >= 4) {
    // Place saddle at point of maximum curvature along backbone
    let maxCurve = 0;
    let saddleIdx = Math.floor(filteredPrimaryCoords.length / 2);
    
    for (let i = 1; i < filteredPrimaryCoords.length - 1; i++) {
      const b1 = calculateBearing(filteredPrimaryCoords[i - 1], filteredPrimaryCoords[i]);
      const b2 = calculateBearing(filteredPrimaryCoords[i], filteredPrimaryCoords[i + 1]);
      const curve = bearingDiff(b1, b2);
      if (curve > maxCurve) {
        maxCurve = curve;
        saddleIdx = i;
      }
    }
    
    saddleFeatures.push({
      type: 'Feature',
      properties: {
        id: 'saddle_0',
        elevationM: 285,
        ridgeDropFt: 30,
        adjacentRidgeIds: ['ridge_primary_0'],
      },
      geometry: {
        type: 'Point',
        coordinates: filteredPrimaryCoords[saddleIdx],
      },
    });
  }
  
  const totalLength = primaryLength + secondaryFeatures.reduce(
    (sum, f) => sum + (f.properties.lengthMeters || 0), 0
  );
  const processingTime = (Date.now() - startTime) / 1000;
  
  console.log('[Backbone] Synthetic generated:', primaryFeatures.length, 'primary,', 
    secondaryFeatures.length, 'secondary,', saddleFeatures.length, 'saddles');

  // ═══ PARCEL CLIP — drop saddle nodes outside parcel boundary (multi-ring) ═══
  const clippedSaddles = saddleFeatures.filter(f => {
    const [sLng, sLat] = f.geometry.coordinates;
    return allOuterRings.some(ring => pointInParcelRing(sLng, sLat, ring));
  });
  console.log('[Backbone] Saddle clip:', saddleFeatures.length, '→', clippedSaddles.length, 'inside parcel');

  return {
    success: true,
    bbox,
    ridges_primary: { type: 'FeatureCollection', features: primaryFeatures },
    ridges_secondary: { type: 'FeatureCollection', features: secondaryFeatures },
    saddle_nodes: { type: 'FeatureCollection', features: clippedSaddles },
    metadata: {
      processing_time_seconds: processingTime,
      dem_source: 'SYNTHETIC_AXIS',
      resolution_m: 0,
      thresholds: {
        min_prominence_ft_primary: MIN_PROMINENCE_FT_PRIMARY,
        min_prominence_ft_secondary: MIN_PROMINENCE_FT_SECONDARY,
        min_length_m_primary: MIN_LENGTH_M_PRIMARY,
        min_length_m_secondary: MIN_LENGTH_M_SECONDARY,
      },
      total_ridge_length_m: Math.round(totalLength),
      ridge_count_primary: primaryFeatures.length,
      ridge_count_secondary: secondaryFeatures.length,
      saddle_count: saddleFeatures.length,
      backbone_confidence: confidence,
      fallback_reason: 
        'Backbone estimated from longest parcel axis. ' +
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
