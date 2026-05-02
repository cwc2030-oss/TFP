/**
 * Corridor Tiering & Intrusion Analysis
 * 
 * Transforms raw corridor data into tiered corridors with:
 * - Primary/Possible/Exploratory tiers based on relative thresholds
 * - Hard/Slight funnel classification
 * - Intrusion scores for huntability overlay
 * - On-parcel vs context (off-parcel) separation
 */

import type { CorridorTier, FunnelStrength, FunnelProperties, TieredCorridorResponse, CorridorMetadata } from '@/types/terrain';

// ========== TIERING THRESHOLDS ==========
// Absolute thresholds (corridor must have at least this score)
const ABS_PRIMARY_THRESHOLD = 0.70;    // Hard floor for primary
const ABS_POSSIBLE_THRESHOLD = 0.35;   // Hard floor for possible
const ABS_EXPLORATORY_THRESHOLD = 0.20; // Hard floor for exploratory

// Relative percentile bands (within parcel + buffer)
const PERCENTILE_PRIMARY = 0.15;       // Top 15% of corridors
const PERCENTILE_POSSIBLE = 0.35;      // Top 15-35%
const PERCENTILE_EXPLORATORY = 0.55;   // Top 35-55%

// Baseline multipliers for relative tiering
const BASELINE_MULT_POSSIBLE = 1.5;    // >=1.5x baseline for possible
const BASELINE_MULT_EXPLORATORY = 1.2; // >=1.2x baseline for exploratory

// ========== FUNNEL STRENGTH THRESHOLDS ==========
// Hard funnels: Strong compression nodes
const FUNNEL_HARD_SCORE = 0.65;        // High corridor score through funnel
const FUNNEL_HARD_WIDTH_MAX = 60;      // Narrowest width <= 60m

// Slight funnels: Moderate compression
const FUNNEL_SLIGHT_SCORE = 0.40;      // Moderate corridor score
const FUNNEL_SLIGHT_WIDTH_MAX = 120;   // Width <= 120m

// ========== INTRUSION SCORING ==========
// Intrusion factors: how "noisy" the approach is
const INTRUSION_ROAD_DIST = 200;       // Distance from roads that matters
const INTRUSION_STRUCTURE_DIST = 300;  // Distance from structures
const INTRUSION_OPEN_FIELD_PENALTY = 0.3; // Crossing open areas

// ========== GEOMETRY UTILITIES ==========

/**
 * Calculate distance between two points in meters
 */
function distanceMeters(p1: [number, number], p2: [number, number]): number {
  const R = 6371000;
  const dLat = (p2[1] - p1[1]) * Math.PI / 180;
  const dLng = (p2[0] - p1[0]) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(p1[1] * Math.PI / 180) * Math.cos(p2[1] * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * Check if a point is inside a polygon (ray casting)
 */
function pointInPolygon(point: [number, number], polygon: number[][]): boolean {
  let inside = false;
  const x = point[0], y = point[1];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Check if a LineString is primarily on the parcel
 * Returns true if >50% of line length is inside parcel
 */
function isLineOnParcel(
  lineCoords: [number, number][],
  parcelCoords: number[][]
): boolean {
  if (lineCoords.length < 2) return false;
  
  let insideLen = 0;
  let totalLen = 0;
  
  for (let i = 0; i < lineCoords.length - 1; i++) {
    const segLen = distanceMeters(lineCoords[i], lineCoords[i + 1]);
    const midpoint: [number, number] = [
      (lineCoords[i][0] + lineCoords[i + 1][0]) / 2,
      (lineCoords[i][1] + lineCoords[i + 1][1]) / 2
    ];
    
    totalLen += segLen;
    if (pointInPolygon(midpoint, parcelCoords)) {
      insideLen += segLen;
    }
  }
  
  return totalLen > 0 && (insideLen / totalLen) > 0.5;
}

/**
 * Compute centroid of a polygon
 */
function polygonCentroid(coords: number[][]): [number, number] {
  let x = 0, y = 0;
  const n = coords.length - 1; // Exclude closing point
  for (let i = 0; i < n; i++) {
    x += coords[i][0];
    y += coords[i][1];
  }
  return [x / n, y / n];
}

// ========== TIERING LOGIC ==========

/**
 * Compute local baseline score from all corridor scores
 * Uses median of lower half for conservative baseline
 */
function computeLocalBaseline(scores: number[]): number {
  if (scores.length === 0) return 0.3; // Default baseline
  
  const sorted = [...scores].sort((a, b) => a - b);
  const lowerHalf = sorted.slice(0, Math.ceil(sorted.length / 2));
  
  // Median of lower half
  const midIdx = Math.floor(lowerHalf.length / 2);
  return lowerHalf.length % 2 === 0
    ? (lowerHalf[midIdx - 1] + lowerHalf[midIdx]) / 2
    : lowerHalf[midIdx];
}

/**
 * Compute percentile thresholds from sorted scores
 */
function computePercentileThresholds(
  scores: number[]
): { primary: number; possible: number; exploratory: number } {
  if (scores.length === 0) {
    return { primary: 0.70, possible: 0.50, exploratory: 0.35 };
  }
  
  const sorted = [...scores].sort((a, b) => b - a); // Descending
  
  const primaryIdx = Math.floor(sorted.length * PERCENTILE_PRIMARY);
  const possibleIdx = Math.floor(sorted.length * PERCENTILE_POSSIBLE);
  const exploratoryIdx = Math.floor(sorted.length * PERCENTILE_EXPLORATORY);
  
  return {
    primary: sorted[Math.min(primaryIdx, sorted.length - 1)] || 0.70,
    possible: sorted[Math.min(possibleIdx, sorted.length - 1)] || 0.50,
    exploratory: sorted[Math.min(exploratoryIdx, sorted.length - 1)] || 0.35,
  };
}

/**
 * Assign tier to a corridor based on score and local context
 */
function assignCorridorTier(
  score: number,
  baseline: number,
  thresholds: { primary: number; possible: number; exploratory: number }
): CorridorTier | null {
  // Check absolute thresholds first
  if (score >= ABS_PRIMARY_THRESHOLD) {
    return 'primary';
  }
  
  // Check relative to percentiles
  if (score >= thresholds.primary) {
    return 'primary';
  }
  
  // Check baseline multipliers
  if (score >= baseline * BASELINE_MULT_POSSIBLE || score >= thresholds.possible) {
    if (score >= ABS_POSSIBLE_THRESHOLD) {
      return 'possible';
    }
  }
  
  if (score >= baseline * BASELINE_MULT_EXPLORATORY || score >= thresholds.exploratory) {
    if (score >= ABS_EXPLORATORY_THRESHOLD) {
      return 'exploratory';
    }
  }
  
  return null; // Below all thresholds
}

/**
 * Assign funnel strength based on compression metrics
 */
function assignFunnelStrength(
  score: number,
  width?: number
): FunnelStrength {
  // Hard funnel: high score AND narrow
  if (score >= FUNNEL_HARD_SCORE && (width === undefined || width <= FUNNEL_HARD_WIDTH_MAX)) {
    return 'hard';
  }
  
  // Slight funnel: moderate score OR wider compression
  if (score >= FUNNEL_SLIGHT_SCORE || (width !== undefined && width <= FUNNEL_SLIGHT_WIDTH_MAX)) {
    return 'slight';
  }
  
  // Default to slight for any detected funnel
  return 'slight';
}

/**
 * Compute intrusion score for a corridor segment
 * Higher = more approach risk (education risk)
 * 
 * Currently uses distance-from-parcel-boundary as proxy
 * In future: integrate road network, structures, open fields
 */
function computeIntrusionScore(
  lineCoords: [number, number][],
  parcelCoords: number[][]
): number {
  if (lineCoords.length < 2) return 0.5; // Default moderate
  
  // Calculate average distance from line to parcel boundary
  // Closer to edge = higher intrusion (harder to approach undetected)
  
  let totalIntrusion = 0;
  let segments = 0;
  
  for (let i = 0; i < lineCoords.length - 1; i++) {
    const midpoint: [number, number] = [
      (lineCoords[i][0] + lineCoords[i + 1][0]) / 2,
      (lineCoords[i][1] + lineCoords[i + 1][1]) / 2
    ];
    
    // Find closest boundary distance
    let minDist = Infinity;
    for (let j = 0; j < parcelCoords.length - 1; j++) {
      const a = parcelCoords[j] as [number, number];
      const b = parcelCoords[j + 1] as [number, number];
      const dist = pointToSegmentDistance(midpoint, a, b);
      minDist = Math.min(minDist, dist);
    }
    
    // Closer to boundary = higher intrusion
    // 0m = 0.9 intrusion, 100m = 0.3 intrusion, 200m+ = 0.1 intrusion
    const intrusion = Math.max(0.1, 0.9 - (minDist / 200) * 0.8);
    totalIntrusion += intrusion;
    segments++;
  }
  
  return segments > 0 ? totalIntrusion / segments : 0.5;
}

/**
 * Distance from point to line segment
 */
function pointToSegmentDistance(
  point: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  
  let t = 0;
  if (len2 > 0) {
    t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2));
  }
  
  const proj: [number, number] = [a[0] + t * dx, a[1] + t * dy];
  return distanceMeters(point, proj);
}

// ========== MAIN TIERING FUNCTION ==========

export interface RawCorridorData {
  corridors: GeoJSON.FeatureCollection;
  funnels?: GeoJSON.FeatureCollection;
  bbox: [number, number, number, number];
}

/**
 * Transform raw corridor data into tiered structure
 * 
 * @param rawData - Raw corridor FeatureCollection from API
 * @param parcelCoords - Parcel boundary coordinates (outer ring)
 * @returns Tiered corridor response
 */
export function tierCorridorData(
  rawData: RawCorridorData,
  parcelCoords: number[][]
): TieredCorridorResponse {
  const corridors = rawData.corridors?.features || [];
  const funnels = rawData.funnels?.features || [];
  
  // Extract all corridor scores for baseline computation
  const allScores = corridors
    .filter(f => f.geometry?.type === 'LineString')
    .map(f => (f.properties as any)?.corridorScore || (f.properties as any)?.probability / 100 || 0.5);
  
  const baseline = computeLocalBaseline(allScores);
  const thresholds = computePercentileThresholds(allScores);
  
  // Initialize tiered collections
  const corridors_primary: GeoJSON.Feature[] = [];
  const corridors_possible: GeoJSON.Feature[] = [];
  const corridors_exploratory: GeoJSON.Feature[] = [];
  const corridors_context_primary: GeoJSON.Feature[] = [];
  const corridors_context_possible: GeoJSON.Feature[] = [];
  const funnels_hard: GeoJSON.Feature[] = [];
  const funnels_slight: GeoJSON.Feature[] = [];
  
  // Process corridors
  corridors.forEach((feature: GeoJSON.Feature) => {
    if (feature.geometry?.type !== 'LineString') return;
    
    const coords = feature.geometry.coordinates as [number, number][];
    const props = feature.properties as any;
    const score = props?.corridorScore || props?.probability / 100 || 0.5;
    
    // Determine if on-parcel or context
    const isOnParcel = isLineOnParcel(coords, parcelCoords);
    
    // Assign tier
    const tier = assignCorridorTier(score, baseline, thresholds);
    if (!tier) return; // Below all thresholds
    
    // Compute intrusion
    const intrusion = computeIntrusionScore(coords, parcelCoords);
    
    // Enrich properties
    const enrichedFeature: GeoJSON.Feature = {
      ...feature,
      properties: {
        ...props,
        funnelType: 'corridor',
        corridorScore: score,
        tier,
        intrusion,
        isOnParcel,
        localBaseline: baseline,
      } as FunnelProperties,
    };
    
    // Route to appropriate collection
    if (isOnParcel) {
      if (tier === 'primary') corridors_primary.push(enrichedFeature);
      else if (tier === 'possible') corridors_possible.push(enrichedFeature);
      else if (tier === 'exploratory') corridors_exploratory.push(enrichedFeature);
    } else {
      // Context (off-parcel)
      if (tier === 'primary') corridors_context_primary.push(enrichedFeature);
      else if (tier === 'possible') corridors_context_possible.push(enrichedFeature);
      // Skip exploratory for context - too faint to matter
    }
  });
  
  // Process funnels (saddles, draws → compression zones)
  funnels.forEach((feature: GeoJSON.Feature) => {
    const props = feature.properties as any;
    const funnelType = props?.funnelType;
    
    // Only process polygon funnels (saddles)
    if (!['Polygon', 'MultiPolygon'].includes(feature.geometry?.type || '')) {
      // LineString funnels (draws) - treat as corridors
      if (feature.geometry?.type === 'LineString') {
        const coords = feature.geometry.coordinates as [number, number][];
        const isOnParcel = isLineOnParcel(coords, parcelCoords);
        const score = props?.corridorScore || 0.5;
        const tier = assignCorridorTier(score, baseline, thresholds);
        
        if (tier && isOnParcel) {
          const enrichedFeature: GeoJSON.Feature = {
            ...feature,
            properties: {
              ...props,
              tier,
              isOnParcel,
            },
          };
          if (tier === 'primary') corridors_primary.push(enrichedFeature);
          else if (tier === 'possible') corridors_possible.push(enrichedFeature);
          else corridors_exploratory.push(enrichedFeature);
        }
      }
      return;
    }
    
    // Polygon funnels → compression zones
    const score = props?.corridorScore || 0.5;
    const width = props?.narrowestWidthMeters;
    const strength = assignFunnelStrength(score, width);
    
    // Check if on parcel
    let centroid: [number, number] = [0, 0];
    if (feature.geometry.type === 'Polygon') {
      centroid = polygonCentroid((feature.geometry as GeoJSON.Polygon).coordinates[0]);
    } else if (feature.geometry.type === 'MultiPolygon') {
      centroid = polygonCentroid((feature.geometry as GeoJSON.MultiPolygon).coordinates[0][0]);
    }
    
    const isOnParcel = pointInPolygon(centroid, parcelCoords);
    if (!isOnParcel) return; // Skip off-parcel funnels for now
    
    const enrichedFeature: GeoJSON.Feature = {
      ...feature,
      properties: {
        ...props,
        strength,
        isOnParcel,
      },
    };
    
    if (strength === 'hard') {
      funnels_hard.push(enrichedFeature);
    } else {
      funnels_slight.push(enrichedFeature);
    }
  });
  
  // Compute coverage stats
  const totalOnParcel = corridors_primary.length + corridors_possible.length + corridors_exploratory.length;
  const coveragePct = totalOnParcel > 0 ? Math.min(100, (totalOnParcel / Math.max(1, allScores.length)) * 100) : 0;
  
  const metadata: CorridorMetadata = {
    processing_time_seconds: 0, // Will be set by caller
    dem_source: 'computed',
    resolution_m: 10,
    weights: {
      slope_preference: 'moderate',
      concavity_weight: 0.4,
    },
    tiering: {
      local_baseline: baseline,
      primary_threshold: Math.max(ABS_PRIMARY_THRESHOLD, thresholds.primary),
      possible_threshold: Math.max(ABS_POSSIBLE_THRESHOLD, thresholds.possible),
      exploratory_threshold: Math.max(ABS_EXPLORATORY_THRESHOLD, thresholds.exploratory),
      parcel_coverage_pct: coveragePct,
    },
    fallback_reason: null,
  };
  
  return {
    success: true,
    bbox: rawData.bbox,
    corridors_primary: { type: 'FeatureCollection', features: corridors_primary } as any,
    corridors_possible: { type: 'FeatureCollection', features: corridors_possible } as any,
    corridors_exploratory: { type: 'FeatureCollection', features: corridors_exploratory } as any,
    funnels_hard: { type: 'FeatureCollection', features: funnels_hard } as any,
    funnels_slight: { type: 'FeatureCollection', features: funnels_slight } as any,
    corridors_context_primary: { type: 'FeatureCollection', features: corridors_context_primary } as any,
    corridors_context_possible: { type: 'FeatureCollection', features: corridors_context_possible } as any,
    metadata,
  };
}

/**
 * Generate synthetic tiered corridors for fallback/demo
 * Creates realistic-looking corridor network within parcel
 */
export function generateSyntheticTieredCorridors(
  bbox: [number, number, number, number],
  parcelCoords: number[][]
): TieredCorridorResponse {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const halfW = (maxLng - minLng) / 2;
  const halfH = (maxLat - minLat) / 2;
  
  // Generate 2-3 primary corridors
  const primaryFeatures: GeoJSON.Feature[] = [];
  for (let i = 0; i < 2 + Math.floor(Math.random()); i++) {
    const angle = (i * 60 + Math.random() * 30) * Math.PI / 180;
    const score = 0.75 + Math.random() * 0.2;
    primaryFeatures.push(createSyntheticCorridor(
      centerLng, centerLat, halfW, halfH, angle, score, 'primary'
    ));
  }
  
  // Generate 2-4 possible corridors
  const possibleFeatures: GeoJSON.Feature[] = [];
  for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
    const angle = (i * 45 + 20 + Math.random() * 25) * Math.PI / 180;
    const score = 0.45 + Math.random() * 0.2;
    possibleFeatures.push(createSyntheticCorridor(
      centerLng, centerLat, halfW * 0.9, halfH * 0.9, angle, score, 'possible'
    ));
  }
  
  // Generate 2-3 exploratory lanes
  const exploratoryFeatures: GeoJSON.Feature[] = [];
  for (let i = 0; i < 2 + Math.floor(Math.random()); i++) {
    const angle = (i * 70 + 35 + Math.random() * 30) * Math.PI / 180;
    const score = 0.25 + Math.random() * 0.15;
    exploratoryFeatures.push(createSyntheticCorridor(
      centerLng, centerLat, halfW * 0.8, halfH * 0.8, angle, score, 'exploratory'
    ));
  }
  
  // Generate 1-2 hard funnels
  const hardFunnels: GeoJSON.Feature[] = [];
  hardFunnels.push(createSyntheticFunnel(
    centerLng + (Math.random() - 0.5) * halfW * 0.5,
    centerLat + (Math.random() - 0.5) * halfH * 0.5,
    25, 0.75, 'hard'
  ));
  
  // Generate 2-3 slight funnels
  const slightFunnels: GeoJSON.Feature[] = [];
  for (let i = 0; i < 2 + Math.floor(Math.random()); i++) {
    slightFunnels.push(createSyntheticFunnel(
      centerLng + (Math.random() - 0.5) * halfW * 0.8,
      centerLat + (Math.random() - 0.5) * halfH * 0.8,
      45, 0.50, 'slight'
    ));
  }
  
  return {
    success: true,
    bbox,
    corridors_primary: { type: 'FeatureCollection', features: primaryFeatures } as any,
    corridors_possible: { type: 'FeatureCollection', features: possibleFeatures } as any,
    corridors_exploratory: { type: 'FeatureCollection', features: exploratoryFeatures } as any,
    funnels_hard: { type: 'FeatureCollection', features: hardFunnels } as any,
    funnels_slight: { type: 'FeatureCollection', features: slightFunnels } as any,
    corridors_context_primary: { type: 'FeatureCollection', features: [] } as any,
    corridors_context_possible: { type: 'FeatureCollection', features: [] } as any,
    metadata: {
      processing_time_seconds: 0.1,
      dem_source: 'SYNTHETIC',
      resolution_m: 0,
      weights: { slope_preference: 'moderate', concavity_weight: 0.4 },
      tiering: {
        local_baseline: 0.35,
        primary_threshold: 0.70,
        possible_threshold: 0.45,
        exploratory_threshold: 0.25,
        parcel_coverage_pct: 75,
      },
      fallback_reason: 'synthetic_demo',
    },
  };
}

function createSyntheticCorridor(
  centerLng: number,
  centerLat: number,
  halfW: number,
  halfH: number,
  angle: number,
  score: number,
  tier: CorridorTier
): GeoJSON.Feature {
  const startLng = centerLng + halfW * 0.8 * Math.cos(angle);
  const startLat = centerLat + halfH * 0.8 * Math.sin(angle);
  const endLng = centerLng - halfW * 0.8 * Math.cos(angle);
  const endLat = centerLat - halfH * 0.8 * Math.sin(angle);
  const midLng = centerLng + (Math.random() - 0.5) * halfW * 0.3;
  const midLat = centerLat + (Math.random() - 0.5) * halfH * 0.3;
  
  return {
    type: 'Feature',
    properties: {
      funnelType: 'corridor',
      corridorScore: score,
      tier,
      intrusion: 0.3 + Math.random() * 0.4,
      isOnParcel: true,
    } as FunnelProperties,
    geometry: {
      type: 'LineString',
      coordinates: [[startLng, startLat], [midLng, midLat], [endLng, endLat]],
    },
  };
}

function createSyntheticFunnel(
  centerLng: number,
  centerLat: number,
  radiusM: number,
  score: number,
  strength: FunnelStrength
): GeoJSON.Feature {
  // Create elliptical polygon
  const points: [number, number][] = [];
  const metersPerDegLat = 111000;
  const metersPerDegLng = 111000 * Math.cos(centerLat * Math.PI / 180);
  
  for (let a = 0; a < 360; a += 30) {
    const rad = a * Math.PI / 180;
    const r = radiusM + (Math.random() - 0.5) * radiusM * 0.3;
    points.push([
      centerLng + (r * Math.cos(rad)) / metersPerDegLng,
      centerLat + (r * Math.sin(rad)) / metersPerDegLat,
    ]);
  }
  points.push(points[0]); // Close ring
  
  return {
    type: 'Feature',
    properties: {
      funnelType: 'saddle',
      corridorScore: score,
      strength,
      isOnParcel: true,
      narrowestWidthMeters: radiusM * 1.5,
    } as FunnelProperties,
    geometry: {
      type: 'Polygon',
      coordinates: [points],
    },
  };
}


// ========== RIDGE-ALIGNMENT ENRICHMENT ==========
// Cross-references corridor centerlines with ridge spines from the independent
// ridge extraction pipeline. When both DEM analyses agree on a terrain feature,
// this constitutes independent confirmation — surfaced as a "movement seam".

/** Distance in meters between two [lng, lat] points (Haversine) */
function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat +
    Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Bearing (0-360°) from a → b */
function bearingDeg(a: [number, number], b: [number, number]): number {
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Angular difference between two bearings, 0-90° (treats line as undirected) */
function bearingDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  if (d > 90) d = 180 - d;
  return d;
}

/** Compute overall bearing of a LineString (first coord → last coord) */
function lineBearing(coords: [number, number][]): number {
  if (coords.length < 2) return 0;
  return bearingDeg(coords[0], coords[coords.length - 1]);
}

/** Minimum distance from a point to the nearest segment of a line */
function pointToLineMinDist(
  pt: [number, number],
  line: [number, number][]
): number {
  let minD = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    // Project pt onto segment a→b
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const proj: [number, number] = [a[0] + t * dx, a[1] + t * dy];
    const d = haversineM(pt, proj);
    if (d < minD) minD = d;
  }
  return minD;
}

export interface RidgeAlignmentResult {
  /** true if this corridor aligns with an independent ridge spine */
  ridgeAligned: boolean;
  /** 0–1: how strongly the corridor aligns (proximity × bearing match) */
  ridgeAlignmentScore: number;
  /** Confidence boost when both pipelines agree (0–0.15 range) */
  ridgeConfidenceBoost: number;
  /** Human-readable explanation */
  ridgeAlignmentReason: string | null;
  /** Which pipeline produced the corridor data */
  source: 'real_dem' | 'synthetic' | 'unknown';
}

// Alignment thresholds
const ALIGNMENT_PROXIMITY_M = 120;  // Corridor must pass within 120m of ridge
const ALIGNMENT_BEARING_DEG = 30;   // Bearing must agree within ±30°
const ALIGNMENT_SAMPLE_STEP = 3;    // Sample every Nth corridor point

/**
 * Check if a single corridor feature aligns with any ridge spine.
 * Alignment = proximity (corridor points close to ridge) + bearing agreement.
 */
function checkSingleCorridorAlignment(
  corridorCoords: [number, number][],
  ridgeLines: [number, number][][],
): { aligned: boolean; score: number; nearestDist: number; bearingDiff: number } {
  if (corridorCoords.length < 2 || ridgeLines.length === 0) {
    return { aligned: false, score: 0, nearestDist: Infinity, bearingDiff: 90 };
  }

  const corridorBrg = lineBearing(corridorCoords);

  let bestScore = 0;
  let bestDist = Infinity;
  let bestBrgDiff = 90;

  for (const ridgeCoords of ridgeLines) {
    if (ridgeCoords.length < 2) continue;

    // Check bearing similarity (undirected)
    const ridgeBrg = lineBearing(ridgeCoords);
    const brgDiff = bearingDiff(corridorBrg, ridgeBrg);
    if (brgDiff > ALIGNMENT_BEARING_DEG) continue; // Bearings too different

    // Sample corridor points and check proximity to this ridge
    let closeCount = 0;
    let totalSampled = 0;
    let minDist = Infinity;

    for (let i = 0; i < corridorCoords.length; i += ALIGNMENT_SAMPLE_STEP) {
      totalSampled++;
      const d = pointToLineMinDist(corridorCoords[i], ridgeCoords);
      if (d < minDist) minDist = d;
      if (d <= ALIGNMENT_PROXIMITY_M) closeCount++;
    }

    if (totalSampled === 0) continue;
    const proximityRatio = closeCount / totalSampled;

    // Score = proximity ratio × bearing match quality
    const brgMatch = 1 - (brgDiff / ALIGNMENT_BEARING_DEG);
    const score = proximityRatio * brgMatch;

    if (score > bestScore) {
      bestScore = score;
      bestDist = minDist;
      bestBrgDiff = brgDiff;
    }
  }

  // Threshold: at least 30% of corridor points must be within range AND bearing must match
  const aligned = bestScore >= 0.3;
  return { aligned, score: bestScore, nearestDist: bestDist, bearingDiff: bestBrgDiff };
}

/**
 * Enrich all corridors in a tiered corridor response with ridge-alignment data.
 * 
 * This is a pure function — it returns NEW FeatureCollections with enriched
 * properties. It does NOT mutate the input. The tier assignment is preserved;
 * alignment only adds metadata + a small confidence boost.
 */
export function enrichCorridorsWithRidgeAlignment(
  tieredData: Record<string, any>,
  ridgePrimary: GeoJSON.FeatureCollection,
  ridgeSecondary: GeoJSON.FeatureCollection,
  ridgeIsSynthetic: boolean,
): {
  enrichedData: Record<string, any>;
  alignmentSummary: {
    totalCorridors: number;
    ridgeAlignedCount: number;
    avgAlignmentScore: number;
  };
} {
  // Collect all ridge spine coordinates
  const ridgeLines: [number, number][][] = [];
  for (const fc of [ridgePrimary, ridgeSecondary]) {
    for (const f of fc.features) {
      if (f.geometry?.type === 'LineString') {
        ridgeLines.push(f.geometry.coordinates as [number, number][]);
      } else if (f.geometry?.type === 'MultiLineString') {
        for (const line of (f.geometry as GeoJSON.MultiLineString).coordinates) {
          ridgeLines.push(line as [number, number][]);
        }
      }
    }
  }

  const source = ridgeIsSynthetic ? 'synthetic' : 'real_dem';

  let totalCorridors = 0;
  let ridgeAlignedCount = 0;
  let sumAlignmentScore = 0;

  // Enrich a single FeatureCollection
  const enrichFC = (fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection => {
    return {
      ...fc,
      features: fc.features.map(f => {
        if (f.geometry?.type !== 'LineString') return f;
        totalCorridors++;

        const coords = f.geometry.coordinates as [number, number][];
        const check = checkSingleCorridorAlignment(coords, ridgeLines);

        if (check.aligned) {
          ridgeAlignedCount++;
          sumAlignmentScore += check.score;
        }

        const alignment: RidgeAlignmentResult = {
          ridgeAligned: check.aligned,
          ridgeAlignmentScore: Math.round(check.score * 100) / 100,
          ridgeConfidenceBoost: check.aligned && source === 'real_dem'
            ? Math.round(Math.min(0.15, check.score * 0.15) * 100) / 100
            : 0,
          ridgeAlignmentReason: check.aligned
            ? `Ridge-aligned movement seam — both elevation spine and corridor model agree (${Math.round(check.nearestDist)}m proximity, ${Math.round(check.bearingDiff)}° bearing match).`
            : null,
          source: source as 'real_dem' | 'synthetic' | 'unknown',
        };

        return {
          ...f,
          properties: {
            ...f.properties,
            ...alignment,
          },
        };
      }),
    };
  };

  const enrichedData: Record<string, any> = {
    ...tieredData,
    corridors_primary: enrichFC(tieredData.corridors_primary),
    corridors_possible: enrichFC(tieredData.corridors_possible),
    corridors_exploratory: enrichFC(tieredData.corridors_exploratory),
    corridors_context_primary: enrichFC(tieredData.corridors_context_primary),
    corridors_context_possible: enrichFC(tieredData.corridors_context_possible),
    // funnels, intrusion_overlay, metadata pass through unchanged
  };

  return {
    enrichedData,
    alignmentSummary: {
      totalCorridors,
      ridgeAlignedCount,
      avgAlignmentScore: ridgeAlignedCount > 0
        ? Math.round((sumAlignmentScore / ridgeAlignedCount) * 100) / 100
        : 0,
    },
  };
}