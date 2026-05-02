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

// ========== SADDLE QUALITY GUARDRAILS ==========
const SADDLE_MIN_SPACING_M = 300;          // Minimum distance between retained saddles
const SADDLE_MIN_PROMINENCE_FT = 20;       // Must have meaningful elevation drop
const SADDLE_MAX_DIST_FROM_RIDGE_M = 150;  // Must be near a ridge spine
const SADDLE_MAX_PER_KM_RIDGE = 1.5;       // Density cap: saddles per km of total ridge length
const SADDLE_MIN_CONFIDENCE = 0.3;         // Confidence threshold (if provided by Modal)

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
  terrainDebug?: Record<string, unknown>;
  saddleDebug?: SaddleDebugPayload;
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
    const rawPrimaryCount = data.ridges_primary?.features?.length || 0;
    const rawSecondaryCount = data.ridges_secondary?.features?.length || 0;
    
    // Use server-reported mode — NOT blind assumption
    const serverMode = data.mode || 'unknown';
    const isSynthetic = serverMode !== 'real_dem';
    
    console.log('[Backbone] Raw response:', {
      duration: durationMs + 'ms',
      primary: rawPrimaryCount,
      secondary: rawSecondaryCount,
      dem_source: data.metadata?.dem_source || 'unknown',
      mode: serverMode,
      isSynthetic,
      terrain_debug: data.terrain_debug ? 'present' : 'absent',
    });
    
    // Log terrain_debug for Phase 1 diagnostics
    if (data.terrain_debug) {
      console.log('[Backbone] terrain_debug:', JSON.stringify(data.terrain_debug, null, 2));
    }
    
    // ─── Quality filter: drop scribbles, stubs, incoherent spines ───
    const { filtered, dropped } = filterSpinesByQuality(data as RidgeSpineResponse);
    if (dropped.length > 0) {
      console.log('[Backbone] Quality filter dropped', dropped.length, 'spine(s):', dropped);
    }
    console.log('[Backbone] Post-filter:', filtered.ridges_primary.features.length, 'P +',
      filtered.ridges_secondary.features.length, 'S (from', rawPrimaryCount, 'P +', rawSecondaryCount, 'S raw)');
    
    // ─── Saddle quality filter: spacing, prominence, proximity, density cap ───
    const rawSaddleCount = filtered.saddle_nodes?.features?.length ?? 0;
    const { filtered: filteredSaddles, debug: saddleDebug } = filterSaddlesByQuality(
      filtered.saddle_nodes ?? { type: 'FeatureCollection', features: [] },
      filtered.ridges_primary,
      filtered.ridges_secondary,
    );
    filtered.saddle_nodes = filteredSaddles as any;
    filtered.metadata.saddle_count = filteredSaddles.features.length;
    console.log(`[Backbone] Saddle filter: ${rawSaddleCount} raw → ${filteredSaddles.features.length} kept`);
    if (saddleDebug.raw_saddle_candidates > 0) {
      console.log('[SaddleDebug]', JSON.stringify(saddleDebug));
    }
    
    return {
      success: true,
      data: filtered,
      durationMs,
      isSynthetic,
      terrainDebug: data.terrain_debug,
      saddleDebug,
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
 * Generate backbone data for parcels — TERRAIN-DRIVEN, NOT QUOTA-DRIVEN
 *
 * Strategy:
 * 1. Find the primary axis (longest-distance pair of boundary vertices)
 * 2. Generate ONE primary ridge along that axis with gentle curvature
 * 3. Generate 1-2 secondary spurs off that primary IF they meet length thresholds
 * 4. Place saddle nodes at spur junctions and curvature maxima
 *
 * CRITICAL RULE: Do NOT scale spine count by acreage. One honest primary
 * ridge is infinitely better than three forced geometries. Additional spines
 * are ONLY added by the real DEM pipeline when the terrain justifies them.
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

  // ===== TERRAIN-DRIVEN COUNTS — NO ACREAGE QUOTA =====
  // Synthetic can only produce ONE primary (the longest axis). Additional primaries
  // require real DEM validation — we refuse to fabricate them from geometry alone.
  const numPrimary = 1;
  // Spurs: max 2, but only if the primary is long enough to justify them
  const spursPerPrimary = parcelAcres < 60 ? 1 : 2;

  console.log('[Backbone] Generating', numPrimary, 'primary (terrain-honest),', spursPerPrimary, 'max spurs for ~', Math.round(parcelAcres), 'ac');

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

    // Strict min length — no relaxation for large territories.
    // If the segment doesn't meet the threshold, it's not a defensible ridge.

    // Add each qualifying segment as a feature
    let addedPrimary = false;
    for (const seg of segments) {
      const segLength = lineLength(seg);
      if (segLength < MIN_LENGTH_M_PRIMARY) continue;

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
      if (spurLength < MIN_LENGTH_M_SECONDARY) continue;

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

// ========== POST-FETCH QUALITY FILTER ==========
// Runs on ALL spine data (real DEM or synthetic) before it reaches the map.
// Drops spines that fail coherence checks — scribbles, fragments, etc.

/** How much a line "scribbles" — total bearing change / length ratio */
function computeCurvatureIncoherence(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  let totalBearingChange = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    const b1 = calculateBearing(coords[i - 1], coords[i]);
    const b2 = calculateBearing(coords[i], coords[i + 1]);
    totalBearingChange += bearingDiff(b1, b2);
  }
  const length = lineLength(coords);
  // Normalize: degrees of bearing change per 100m of line
  return length > 0 ? (totalBearingChange / length) * 100 : 999;
}

/**
 * Filter spine FeatureCollections by quality criteria.
 * Drops individual features that fail coherence, length, or confidence checks.
 * Returns filtered data + summary of what was dropped.
 */
export function filterSpinesByQuality(
  data: RidgeSpineResponse,
  opts?: {
    /** Max curvature incoherence (°/100m). Default 40. Ridge spine should not zig-zag. */
    maxIncoherence?: number;
    /** Min length for primary spines (m). Default uses module constant. */
    minPrimaryLengthM?: number;
    /** Min length for secondary spines (m). Default uses module constant. */
    minSecondaryLengthM?: number;
    /** Min coordinate count — drop stubs. Default 3. */
    minCoordCount?: number;
    /** Max spines total (primary+secondary combined). 0 = no cap. Default 0. */
    maxSpinesTotal?: number;
  }
): { filtered: RidgeSpineResponse; dropped: { id: string; reason: string }[] } {
  const maxIncoherence = opts?.maxIncoherence ?? 40;
  const minPrimaryLen = opts?.minPrimaryLengthM ?? MIN_LENGTH_M_PRIMARY;
  const minSecondaryLen = opts?.minSecondaryLengthM ?? MIN_LENGTH_M_SECONDARY;
  const minCoords = opts?.minCoordCount ?? 3;
  const maxTotal = opts?.maxSpinesTotal ?? 0;

  const dropped: { id: string; reason: string }[] = [];

  function filterFC(
    fc: GeoJSON.FeatureCollection,
    tier: 'primary' | 'secondary'
  ): GeoJSON.FeatureCollection {
    const minLen = tier === 'primary' ? minPrimaryLen : minSecondaryLen;

    const passing = fc.features.filter(f => {
      const id = (f.properties as any)?.id || 'unknown';
      const coords = f.geometry?.type === 'LineString'
        ? f.geometry.coordinates as [number, number][]
        : null;

      if (!coords || coords.length < minCoords) {
        dropped.push({ id, reason: `Too few coordinates (${coords?.length ?? 0} < ${minCoords})` });
        return false;
      }

      const len = lineLength(coords);
      if (len < minLen) {
        dropped.push({ id, reason: `Too short (${Math.round(len)}m < ${minLen}m)` });
        return false;
      }

      const incoherence = computeCurvatureIncoherence(coords);
      if (incoherence > maxIncoherence) {
        dropped.push({ id, reason: `Scribble detected — curvature incoherence ${incoherence.toFixed(1)}°/100m > ${maxIncoherence}°/100m threshold` });
        return false;
      }

      return true;
    });

    return { ...fc, features: passing };
  }

  let filteredPrimary = filterFC(data.ridges_primary, 'primary');
  let filteredSecondary = filterFC(data.ridges_secondary, 'secondary');

  // Optional total cap — keep highest-quality (longest) spines first
  if (maxTotal > 0) {
    const all = [
      ...filteredPrimary.features.map(f => ({ f, tier: 'primary' as const })),
      ...filteredSecondary.features.map(f => ({ f, tier: 'secondary' as const })),
    ];
    if (all.length > maxTotal) {
      // Sort by length descending, keep top N
      all.sort((a, b) => {
        const lenA = (a.f.properties as any)?.lengthMeters ?? lineLength(
          a.f.geometry?.type === 'LineString' ? a.f.geometry.coordinates as [number, number][] : []
        );
        const lenB = (b.f.properties as any)?.lengthMeters ?? lineLength(
          b.f.geometry?.type === 'LineString' ? b.f.geometry.coordinates as [number, number][] : []
        );
        return lenB - lenA;
      });
      const kept = all.slice(0, maxTotal);
      const trimmed = all.slice(maxTotal);
      for (const t of trimmed) {
        dropped.push({
          id: (t.f.properties as any)?.id || 'unknown',
          reason: `Exceeded max spine cap (${maxTotal})`,
        });
      }
      filteredPrimary = {
        ...filteredPrimary,
        features: kept.filter(k => k.tier === 'primary').map(k => k.f),
      };
      filteredSecondary = {
        ...filteredSecondary,
        features: kept.filter(k => k.tier === 'secondary').map(k => k.f),
      };
    }
  }

  // Update metadata counts
  const filtered: RidgeSpineResponse = {
    ...data,
    ridges_primary: filteredPrimary as any,
    ridges_secondary: filteredSecondary as any,
    metadata: {
      ...data.metadata,
      ridge_count_primary: filteredPrimary.features.length,
      ridge_count_secondary: filteredSecondary.features.length,
    },
  };

  return { filtered, dropped };
}

// ========== SADDLE QUALITY FILTER ==========

export interface SaddleDebugPayload {
  raw_saddle_candidates: number;
  post_prominence_filter: number;
  post_ridge_proximity_filter: number;
  post_spacing_filter: number;
  post_density_cap: number;
  final_saddles: number;
  min_spacing_m: number;
  total_ridge_length_km: number;
  density_cap_per_km: number;
  candidates: Array<{
    id: string;
    elevationM: number;
    ridgeDropFt: number;
    dist_to_nearest_ridge_m: number;
    nearest_ridge_id: string;
    confidence?: number;
    kept: boolean;
    drop_reason: string | null;
  }>;
}

/** Perpendicular distance from point to line segment (metres) */
function pointToSegmentDistM(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return distanceMeters(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  const proj: [number, number] = [a[0] + t * dx, a[1] + t * dy];
  return distanceMeters(p, proj);
}

/**
 * Filter saddle nodes by quality criteria:
 * 1. Prominence: ridgeDropFt >= threshold
 * 2. Ridge proximity: must be near an actual ridge spine
 * 3. Spacing: enforce minimum distance between retained saddles
 * 4. Density cap: max saddles per km of total ridge length
 *
 * Returns filtered saddle FC + debug payload for [SaddleDebug] console emission.
 */
export function filterSaddlesByQuality(
  saddleFC: GeoJSON.FeatureCollection,
  ridgePrimary: GeoJSON.FeatureCollection,
  ridgeSecondary: GeoJSON.FeatureCollection,
  opts?: {
    minSpacingM?: number;
    minProminenceFt?: number;
    maxDistFromRidgeM?: number;
    maxPerKmRidge?: number;
    minConfidence?: number;
  }
): { filtered: GeoJSON.FeatureCollection; debug: SaddleDebugPayload } {
  const minSpacing = opts?.minSpacingM ?? SADDLE_MIN_SPACING_M;
  const minProm = opts?.minProminenceFt ?? SADDLE_MIN_PROMINENCE_FT;
  const maxRidgeDist = opts?.maxDistFromRidgeM ?? SADDLE_MAX_DIST_FROM_RIDGE_M;
  const maxPerKm = opts?.maxPerKmRidge ?? SADDLE_MAX_PER_KM_RIDGE;
  const minConf = opts?.minConfidence ?? SADDLE_MIN_CONFIDENCE;

  // Collect all ridge line geometries for proximity checks
  const ridgeLines: { id: string; coords: number[][] }[] = [];
  for (const fc of [ridgePrimary, ridgeSecondary]) {
    for (const f of fc.features) {
      if (f.geometry?.type === 'LineString') {
        ridgeLines.push({
          id: (f.properties as any)?.id || 'unknown',
          coords: f.geometry.coordinates,
        });
      }
    }
  }

  // Total ridge length for density cap
  const totalRidgeLengthM = ridgeLines.reduce((sum, rl) => {
    return sum + lineLength(rl.coords as [number, number][]);
  }, 0);
  const totalRidgeLengthKm = totalRidgeLengthM / 1000;
  const densityCap = Math.max(1, Math.ceil(totalRidgeLengthKm * maxPerKm));

  const rawCount = saddleFC.features.length;

  // Build candidate diagnostics
  const candidates: SaddleDebugPayload['candidates'] = [];

  // ── Step 1: compute per-saddle metrics ──
  type SaddleCandidate = {
    feature: GeoJSON.Feature;
    pt: [number, number];
    ridgeDropFt: number;
    confidence: number;
    distToRidgeM: number;
    nearestRidgeId: string;
    sortScore: number;
  };
  const scored: SaddleCandidate[] = [];

  for (const f of saddleFC.features) {
    if (f.geometry?.type !== 'Point') continue;
    const pt = f.geometry.coordinates as [number, number];
    const props = f.properties as Record<string, any>;
    const ridgeDropFt = props?.ridgeDropFt ?? 0;
    const confidence = props?.confidence ?? 1.0;
    const id = props?.id ?? 'unknown';

    // Find nearest ridge
    let minRidgeDist = Infinity;
    let nearestRidgeId = 'none';
    for (const rl of ridgeLines) {
      for (let i = 0; i < rl.coords.length - 1; i++) {
        const d = pointToSegmentDistM(pt, rl.coords[i] as [number, number], rl.coords[i + 1] as [number, number]);
        if (d < minRidgeDist) {
          minRidgeDist = d;
          nearestRidgeId = rl.id;
        }
      }
    }

    // Composite score for greedy-pick ordering: higher = better saddle
    // Prominence weight is dominant — a real pass has high drop
    const promNorm = Math.min(1, ridgeDropFt / 60); // 60ft = perfect
    const proxNorm = Math.max(0, 1 - minRidgeDist / maxRidgeDist); // closer to ridge = better
    const sortScore = promNorm * 0.6 + proxNorm * 0.3 + confidence * 0.1;

    scored.push({ feature: f, pt, ridgeDropFt, confidence, distToRidgeM: minRidgeDist, nearestRidgeId, sortScore });
  }

  // ── Step 2: Prominence filter ──
  let pool = scored.filter(s => {
    const pass = s.ridgeDropFt >= minProm;
    if (!pass) {
      candidates.push({
        id: (s.feature.properties as any)?.id ?? 'unknown',
        elevationM: (s.feature.properties as any)?.elevationM ?? 0,
        ridgeDropFt: s.ridgeDropFt,
        dist_to_nearest_ridge_m: Math.round(s.distToRidgeM),
        nearest_ridge_id: s.nearestRidgeId,
        confidence: s.confidence,
        kept: false,
        drop_reason: `prominence_too_low (${s.ridgeDropFt}ft < ${minProm}ft)`,
      });
    }
    return pass;
  });
  const postProminence = pool.length;

  // ── Step 3: Ridge proximity filter ──
  pool = pool.filter(s => {
    const pass = s.distToRidgeM <= maxRidgeDist;
    if (!pass) {
      candidates.push({
        id: (s.feature.properties as any)?.id ?? 'unknown',
        elevationM: (s.feature.properties as any)?.elevationM ?? 0,
        ridgeDropFt: s.ridgeDropFt,
        dist_to_nearest_ridge_m: Math.round(s.distToRidgeM),
        nearest_ridge_id: s.nearestRidgeId,
        confidence: s.confidence,
        kept: false,
        drop_reason: `too_far_from_ridge (${Math.round(s.distToRidgeM)}m > ${maxRidgeDist}m)`,
      });
    }
    return pass;
  });
  const postRidgeProximity = pool.length;

  // ── Step 4: Confidence filter (if Modal provides confidence) ──
  pool = pool.filter(s => {
    if (s.confidence < minConf) {
      candidates.push({
        id: (s.feature.properties as any)?.id ?? 'unknown',
        elevationM: (s.feature.properties as any)?.elevationM ?? 0,
        ridgeDropFt: s.ridgeDropFt,
        dist_to_nearest_ridge_m: Math.round(s.distToRidgeM),
        nearest_ridge_id: s.nearestRidgeId,
        confidence: s.confidence,
        kept: false,
        drop_reason: `confidence_too_low (${s.confidence.toFixed(2)} < ${minConf})`,
      });
      return false;
    }
    return true;
  });

  // ── Step 5: Spacing filter (greedy pick — best saddles first) ──
  pool.sort((a, b) => b.sortScore - a.sortScore);
  const spacingKept: SaddleCandidate[] = [];
  for (const s of pool) {
    const tooClose = spacingKept.some(k => distanceMeters(s.pt, k.pt) < minSpacing);
    if (tooClose) {
      candidates.push({
        id: (s.feature.properties as any)?.id ?? 'unknown',
        elevationM: (s.feature.properties as any)?.elevationM ?? 0,
        ridgeDropFt: s.ridgeDropFt,
        dist_to_nearest_ridge_m: Math.round(s.distToRidgeM),
        nearest_ridge_id: s.nearestRidgeId,
        confidence: s.confidence,
        kept: false,
        drop_reason: `too_close_to_better_saddle (< ${minSpacing}m)`,
      });
    } else {
      spacingKept.push(s);
    }
  }
  const postSpacing = spacingKept.length;

  // ── Step 6: Density cap ──
  let finalPool = spacingKept;
  if (finalPool.length > densityCap) {
    // Already sorted by quality — trim the tail
    const trimmed = finalPool.slice(densityCap);
    finalPool = finalPool.slice(0, densityCap);
    for (const s of trimmed) {
      candidates.push({
        id: (s.feature.properties as any)?.id ?? 'unknown',
        elevationM: (s.feature.properties as any)?.elevationM ?? 0,
        ridgeDropFt: s.ridgeDropFt,
        dist_to_nearest_ridge_m: Math.round(s.distToRidgeM),
        nearest_ridge_id: s.nearestRidgeId,
        confidence: s.confidence,
        kept: false,
        drop_reason: `density_cap_exceeded (${densityCap} max for ${totalRidgeLengthKm.toFixed(1)}km ridge)`,
      });
    }
  }
  const postDensity = finalPool.length;

  // Add kept candidates to debug
  for (const s of finalPool) {
    candidates.push({
      id: (s.feature.properties as any)?.id ?? 'unknown',
      elevationM: (s.feature.properties as any)?.elevationM ?? 0,
      ridgeDropFt: s.ridgeDropFt,
      dist_to_nearest_ridge_m: Math.round(s.distToRidgeM),
      nearest_ridge_id: s.nearestRidgeId,
      confidence: s.confidence,
      kept: true,
      drop_reason: null,
    });
  }

  const debug: SaddleDebugPayload = {
    raw_saddle_candidates: rawCount,
    post_prominence_filter: postProminence,
    post_ridge_proximity_filter: postRidgeProximity,
    post_spacing_filter: postSpacing,
    post_density_cap: postDensity,
    final_saddles: finalPool.length,
    min_spacing_m: minSpacing,
    total_ridge_length_km: Math.round(totalRidgeLengthKm * 10) / 10,
    density_cap_per_km: maxPerKm,
    candidates,
  };

  const filteredFC: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: finalPool.map(s => s.feature),
  };

  return { filtered: filteredFC, debug };
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
