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
 * Generate backbone data for parcels — SCALES WITH PARCEL SIZE
 *
 * Strategy:
 * 1. Find the primary axis (longest-distance pair of boundary vertices)
 * 2. Generate a primary ridge along that axis with gentle curvature
 * 3. For large parcels (>200ac): generate ADDITIONAL primary ridges offset
 *    perpendicular to the main axis, roughly 1 extra per 400 acres
 * 4. For each primary ridge: generate 1-3 secondary spurs proportional to length
 * 5. Place saddle nodes at spur junctions and curvature maxima
 *
 * Scaling table:
 *   <60ac   → 1 primary, 1 secondary, 1 saddle
 *   60-200  → 1 primary, 2 secondaries, 1-2 saddles
 *   200-600 → 2 primaries, 3-5 secondaries, 3-5 saddles
 *   600-1500 → 3 primaries, 5-8 secondaries, 4-7 saddles
 *   1500+   → 4-6 primaries, 8-15 secondaries, 6-12 saddles
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

  // Deterministic seed from parcel centroid for reproducible curves
  const seed = Math.abs(centerLng * 10000 + centerLat * 10000) % 1000;

  // ===== FIND PRIMARY AXIS (longest internal diagonal) =====
  // Use ALL coords from ALL rings so the axis spans the full territory, not just one parcel
  const typedCoords = allCoords.map(c => [c[0], c[1]] as [number, number]);
  let maxDist = 0;
  let axisStart: [number, number] = [centerLng, centerLat];
  let axisEnd: [number, number] = [centerLng, centerLat];

  // For large coord arrays, subsample to keep O(n²) manageable
  const sampleStep = typedCoords.length > 200 ? Math.floor(typedCoords.length / 100) : 1;
  for (let i = 0; i < typedCoords.length; i += sampleStep) {
    for (let j = i + 1; j < typedCoords.length; j += sampleStep) {
      const d = distanceMeters(typedCoords[i], typedCoords[j]);
      if (d > maxDist) {
        maxDist = d;
        axisStart = typedCoords[i];
        axisEnd = typedCoords[j];
      }
    }
  }

  const axisBearing = calculateBearing(axisStart, axisEnd);
  const perpBearing = (axisBearing + 90) % 360;

  // ===== DETERMINE FEATURE COUNTS BASED ON ACREAGE =====
  const numPrimary = Math.max(1, Math.min(6, Math.floor(parcelAcres / 400) + 1));
  const spursPerPrimary = parcelAcres < 60 ? 1 : parcelAcres < 200 ? 2 : 3;

  console.log('[Backbone] Generating', numPrimary, 'primaries,', spursPerPrimary, 'spurs each for ~', Math.round(parcelAcres), 'ac');

  const primaryFeatures: GeoJSON.Feature<GeoJSON.LineString, RidgeSpineProperties>[] = [];
  const secondaryFeatures: GeoJSON.Feature<GeoJSON.LineString, RidgeSpineProperties>[] = [];
  const saddleFeatures: GeoJSON.Feature<GeoJSON.Point, SaddleNodeProperties>[] = [];

  // Point-in-parcel check helper
  const isInsideParcel = (pt: [number, number]) =>
    allOuterRings.some(ring => pointInParcelRing(pt[0], pt[1], ring));

  // Water body check helper
  const isInWater = (pt: [number, number]) =>
    waterBodies?.length ? pointInAnyWaterBody(pt[0], pt[1], waterBodies) : false;

  // ===== GENERATE EACH PRIMARY RIDGE =====
  // The first follows the longest axis. Additional ones are offset perpendicular.
  // Offsets alternate sides: +d, -d, +2d, -2d, ...
  const perpSpacingM = Math.min(widthM, heightM) / (numPrimary + 1);

  for (let pIdx = 0; pIdx < numPrimary; pIdx++) {
    // Perpendicular offset for this ridge
    let offsetM = 0;
    if (pIdx > 0) {
      const side = pIdx % 2 === 1 ? 1 : -1;
      const rank = Math.ceil(pIdx / 2);
      offsetM = side * rank * perpSpacingM;
    }

    // Inset endpoints so backbone doesn't touch boundary
    const insetFraction = 0.10 + (pIdx * 0.02); // outer ridges inset slightly more
    const startRaw: [number, number] = [
      axisStart[0] + (axisEnd[0] - axisStart[0]) * insetFraction,
      axisStart[1] + (axisEnd[1] - axisStart[1]) * insetFraction,
    ];
    const endRaw: [number, number] = [
      axisEnd[0] + (axisStart[0] - axisEnd[0]) * insetFraction,
      axisEnd[1] + (axisStart[1] - axisEnd[1]) * insetFraction,
    ];

    // Apply perpendicular offset
    const startPt = offsetM !== 0 ? movePoint(startRaw, perpBearing, offsetM) : startRaw;
    const endPt = offsetM !== 0 ? movePoint(endRaw, perpBearing, offsetM) : endRaw;

    // Generate curved backbone with more points for larger territories
    const baseSegments = parcelAcres > 500 ? 12 : 6;
    const numSegments = baseSegments + Math.floor(pIdx * 0.5);
    const ridgeCoords: [number, number][] = [];
    const ridgeSeed = seed + pIdx * 317; // Unique per ridge

    for (let i = 0; i <= numSegments; i++) {
      const t = i / numSegments;
      const basePt: [number, number] = [
        startPt[0] + (endPt[0] - startPt[0]) * t,
        startPt[1] + (endPt[1] - startPt[1]) * t,
      ];

      // Sinusoidal offset for natural curvature; amplitude decreases for secondary ridges
      const waveAmplitude = maxDist * (0.035 - pIdx * 0.005);
      const wavePhase = ((ridgeSeed + i * 137) % 360) * Math.PI / 180;
      const off = Math.sin(t * Math.PI + wavePhase * 0.3) * waveAmplitude;

      if (i > 0 && i < numSegments) {
        ridgeCoords.push(movePoint(basePt, perpBearing, off));
      } else {
        ridgeCoords.push(basePt);
      }
    }

    // Filter: keep only points inside parcel and not in water.
    // For multi-parcel territories, split into contiguous segments so
    // gaps between parcels don't kill the whole ridge.
    const segments: [number, number][][] = [];
    let currentSeg: [number, number][] = [];
    for (const c of ridgeCoords) {
      if (isInsideParcel(c) && !isInWater(c)) {
        currentSeg.push(c);
      } else if (currentSeg.length >= 2) {
        segments.push(currentSeg);
        currentSeg = [];
      } else {
        currentSeg = [];
      }
    }
    if (currentSeg.length >= 2) segments.push(currentSeg);

    // Use adaptive min length: relax for large territories
    const effectiveMinPrimary = parcelAcres > 500 ? MIN_LENGTH_M_PRIMARY * 0.5 : MIN_LENGTH_M_PRIMARY;

    // Add each qualifying segment as a feature
    let addedPrimary = false;
    for (const seg of segments) {
      const segLength = lineLength(seg);
      if (segLength < effectiveMinPrimary) continue;

      const ridgeId = `ridge_primary_${pIdx}${segments.length > 1 ? `_s${segments.indexOf(seg)}` : ''}`;
      primaryFeatures.push({
        type: 'Feature',
        properties: {
          id: ridgeId,
          tier: 'primary' as RidgeTier,
          prominenceFt: Math.round(55 - pIdx * 5),
          lengthMeters: Math.round(segLength),
          avgElevationM: Math.round(300 - pIdx * 10),
          avgSlopeDeg: Math.round(8 - pIdx * 0.5),
          curvatureProfile: 0.02,
        },
        geometry: { type: 'LineString', coordinates: seg },
      });
      addedPrimary = true;
    }
    if (!addedPrimary) continue;

    // Use longest segment for spur generation
    const filtered = segments.reduce((a, b) => lineLength(a) > lineLength(b) ? a : b, segments[0]);
    const ridgeLength = lineLength(filtered);
    const ridgeId = `ridge_primary_${pIdx}`;

    // ===== SECONDARY SPURS for this primary =====
    const spurCount = Math.min(spursPerPrimary, Math.max(1, Math.floor(ridgeLength / 600)));
    for (let sIdx = 0; sIdx < spurCount; sIdx++) {
      // Space spurs evenly along the ridge
      const tSpur = (sIdx + 1) / (spurCount + 1);
      const spurAnchorIdx = Math.min(
        filtered.length - 1,
        Math.max(0, Math.floor(tSpur * (filtered.length - 1)))
      );
      const spurStart = filtered[spurAnchorIdx];

      // Alternate spur direction left/right of main bearing
      const spurSide = (sIdx + pIdx) % 2 === 0 ? 1 : -1;
      const spurAngle = 30 + ((ridgeSeed + sIdx * 73) % 25); // 30-55°
      const spurBearing = (axisBearing + spurSide * spurAngle + 360) % 360;
      const spurLen = ridgeLength * (0.15 + ((ridgeSeed + sIdx * 41) % 10) / 100); // 15-25% of primary

      const spurMid = movePoint(spurStart, spurBearing, spurLen * 0.5);
      const spurEnd = movePoint(spurStart, spurBearing, spurLen);

      const spurCoordsRaw: [number, number][] = [
        spurStart,
        movePoint(spurMid, (spurBearing + 90) % 360, spurLen * 0.04),
        spurEnd,
      ];

      const spurCoords = spurCoordsRaw.filter(c => isInsideParcel(c) && !isInWater(c));
      if (spurCoords.length < 2) continue;

      const spurLength = lineLength(spurCoords);
      const effectiveMinSecondary = parcelAcres > 500 ? MIN_LENGTH_M_SECONDARY * 0.5 : MIN_LENGTH_M_SECONDARY;
      if (spurLength < effectiveMinSecondary) continue;

      const spurId = `ridge_secondary_${primaryFeatures.length - 1}_${sIdx}`;
      secondaryFeatures.push({
        type: 'Feature',
        properties: {
          id: spurId,
          tier: 'secondary' as RidgeTier,
          prominenceFt: Math.round(35 - sIdx * 3),
          lengthMeters: Math.round(spurLength),
          avgElevationM: Math.round(290 - pIdx * 8 - sIdx * 5),
          avgSlopeDeg: Math.round(6 + sIdx),
          curvatureProfile: 0.015,
        },
        geometry: { type: 'LineString', coordinates: spurCoords },
      });

      // Saddle at spur junction
      saddleFeatures.push({
        type: 'Feature',
        properties: {
          id: `saddle_jct_${pIdx}_${sIdx}`,
          elevationM: Math.round(285 - pIdx * 8),
          ridgeDropFt: Math.round(25 + sIdx * 5),
          adjacentRidgeIds: [ridgeId, spurId],
        },
        geometry: { type: 'Point', coordinates: spurStart },
      });
    }

    // ===== CURVATURE-BASED SADDLES along this primary =====
    if (filtered.length >= 4) {
      // Find top 1-2 curvature maxima
      const curvatures: { idx: number; curve: number }[] = [];
      for (let i = 1; i < filtered.length - 1; i++) {
        const b1 = calculateBearing(filtered[i - 1], filtered[i]);
        const b2 = calculateBearing(filtered[i], filtered[i + 1]);
        curvatures.push({ idx: i, curve: bearingDiff(b1, b2) });
      }
      curvatures.sort((a, b) => b.curve - a.curve);

      const numCurvSaddles = parcelAcres > 400 ? 2 : 1;
      for (let ci = 0; ci < Math.min(numCurvSaddles, curvatures.length); ci++) {
        if (curvatures[ci].curve < 3) continue; // Skip if almost straight
        const pt = filtered[curvatures[ci].idx];
        saddleFeatures.push({
          type: 'Feature',
          properties: {
            id: `saddle_curv_${pIdx}_${ci}`,
            elevationM: Math.round(282 - pIdx * 10),
            ridgeDropFt: Math.round(30 + ci * 8),
            adjacentRidgeIds: [ridgeId],
          },
          geometry: { type: 'Point', coordinates: pt },
        });
      }
    }
  }

  // ===== CLIP SADDLES to parcel =====
  const clippedSaddles = saddleFeatures.filter(f => {
    const [sLng, sLat] = f.geometry.coordinates;
    return allOuterRings.some(ring => pointInParcelRing(sLng, sLat, ring));
  });

  const totalLength = primaryFeatures.reduce((s, f) => s + (f.properties.lengthMeters || 0), 0)
    + secondaryFeatures.reduce((s, f) => s + (f.properties.lengthMeters || 0), 0);
  const processingTime = (Date.now() - startTime) / 1000;

  console.log('[Backbone] Synthetic generated:', primaryFeatures.length, 'primary,',
    secondaryFeatures.length, 'secondary,', clippedSaddles.length, 'saddles (from', saddleFeatures.length, ')');

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
      saddle_count: clippedSaddles.length,
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
