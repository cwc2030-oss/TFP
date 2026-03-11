/**
 * Terrain Flow Analysis Library
 * 
 * Computes terrain-guided movement likelihood surfaces and extracts
 * flow lines, convergence zones, and opportunity areas.
 * 
 * This is NOT wildlife AI — it's terrain-guided movement structure.
 * 
 * Core Philosophy:
 * "If an animal wanted to move efficiently through this parcel
 * while following natural terrain structure, where would the
 * land tend to guide movement?"
 * 
 * V1 Weighted Formula (normalized 0-1 inputs):
 * terrain_flow_likelihood =
 *   0.30 * bench_likelihood
 * + 0.25 * saddle_proximity
 * + 0.20 * spine_proximity
 * + 0.15 * terrain_convergence
 * + 0.10 * moderate_slope_preference
 */

import type {
  TerrainFlowResponse,
  FlowLineProperties,
  ConvergenceZoneProperties,
  OpportunityZoneProperties,
  TerrainFlowMetadata,
  FlowTier,
} from '@/types/terrain-flow';

// ========== V1 CONFIGURATION ==========

// Weights for movement likelihood surface
export const FLOW_WEIGHTS = {
  bench_likelihood: 0.30,       // Sidehill travel benches
  saddle_proximity: 0.25,       // Terrain crossing approaches
  spine_proximity: 0.20,        // Ridge-structured movement
  terrain_convergence: 0.15,    // Natural pinch/funnel geometry
  moderate_slope: 0.10,         // Energy-efficient travel slopes
};

// Thresholds for flow extraction
export const FLOW_THRESHOLDS = {
  // Primary flow: top tier (≥75th percentile)
  primary_min: 0.75,
  // Secondary flow: significant (≥55th percentile)
  secondary_min: 0.55,
  // Minimum length for flow lines (meters)
  min_length_m_primary: 150,
  min_length_m_secondary: 80,
  // Convergence zone threshold (overlap intensity)
  convergence_threshold: 0.70,
  // Opportunity zone threshold
  opportunity_threshold: 0.80,
};

// Slope preference bands (degrees)
export const SLOPE_BANDS = {
  optimal_min: 5,
  optimal_max: 15,
  acceptable_min: 2,
  acceptable_max: 25,
  penalty_threshold: 35,
};

// ========== API CLIENT ==========

const TERRAIN_FLOW_API_URL = '/api/terrain-flow';
const REQUEST_TIMEOUT_MS = 45000;

export interface TerrainFlowRequestParams {
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  parcel_id: string;
  bufferMeters?: number;
  options?: {
    weights?: Partial<typeof FLOW_WEIGHTS>;
    thresholds?: Partial<typeof FLOW_THRESHOLDS>;
    includeDebugLayers?: boolean;
  };
}

export interface TerrainFlowFetchResult {
  success: boolean;
  data?: TerrainFlowResponse;
  error?: string;
  status?: number;
  durationMs: number;
  isSynthetic: boolean;
}

/**
 * Fetch terrain flow data from API
 */
export async function fetchTerrainFlow(
  params: TerrainFlowRequestParams,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<TerrainFlowFetchResult> {
  const startTime = Date.now();
  
  console.log('[TerrainFlow] === FETCH START ===');
  console.log('[TerrainFlow] Parcel ID:', params.parcel_id);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(TERRAIN_FLOW_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parcel: params.parcel,
        parcel_id: params.parcel_id,
        bufferMeters: params.bufferMeters ?? 400,
        options: params.options || {},
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[TerrainFlow] API error:', errorText);
      
      // Fall back to synthetic generation
      const syntheticData = generateSyntheticTerrainFlow(params.parcel);
      return {
        success: true,
        data: syntheticData,
        durationMs,
        isSynthetic: true,
      };
    }
    
    const data = await response.json();
    const primaryCount = data.flow_primary?.features?.length || 0;
    const secondaryCount = data.flow_secondary?.features?.length || 0;
    const convergenceCount = data.convergence_zones?.features?.length || 0;
    
    console.log('[TerrainFlow] Response:', {
      duration: durationMs + 'ms',
      primary: primaryCount,
      secondary: secondaryCount,
      convergence: convergenceCount,
      mode: data.metadata?.mode || 'unknown',
    });
    
    return {
      success: true,
      data: data as TerrainFlowResponse,
      durationMs,
      isSynthetic: data.metadata?.mode === 'synthetic',
    };
    
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn('[TerrainFlow] Fetch failed:', errMsg);
    
    // Fall back to synthetic generation
    const syntheticData = generateSyntheticTerrainFlow(params.parcel);
    return {
      success: true,
      data: syntheticData,
      durationMs,
      isSynthetic: true,
    };
  }
}

// ========== GEOMETRY UTILITIES ==========

function distanceMeters(p1: [number, number], p2: [number, number]): number {
  const R = 6371000;
  const dLat = (p2[1] - p1[1]) * Math.PI / 180;
  const dLng = (p2[0] - p1[0]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1[1] * Math.PI / 180) * Math.cos(p2[1] * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateBearing(from: [number, number], to: [number, number]): number {
  const lat1 = from[1] * Math.PI / 180;
  const lat2 = to[1] * Math.PI / 180;
  const dLng = (to[0] - from[0]) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

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

function getBbox(coords: number[][]): [number, number, number, number] {
  const lngs = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  return [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats),
  ];
}

function getCentroid(coords: number[][]): [number, number] {
  const n = coords.length;
  const sumLng = coords.reduce((sum, c) => sum + c[0], 0);
  const sumLat = coords.reduce((sum, c) => sum + c[1], 0);
  return [sumLng / n, sumLat / n];
}

// ========== SYNTHETIC FLOW GENERATION ==========

/**
 * Generate synthetic terrain flow lines based on parcel geometry.
 * 
 * This is a geometric approximation when real DEM data isn't available.
 * It creates believable flow patterns based on parcel shape and orientation.
 */
export function generateSyntheticTerrainFlow(
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
): TerrainFlowResponse {
  const startTime = Date.now();
  
  // Extract parcel coordinates
  let coords: number[][] = [];
  if (parcel.geometry.type === 'Polygon') {
    coords = parcel.geometry.coordinates[0];
  } else {
    let maxLen = 0;
    parcel.geometry.coordinates.forEach(poly => {
      if (poly[0].length > maxLen) {
        maxLen = poly[0].length;
        coords = poly[0];
      }
    });
  }
  
  if (coords.length < 4) {
    return emptyFlowResponse('Insufficient parcel coordinates');
  }
  
  const bbox = getBbox(coords);
  const centroid = getCentroid(coords);
  const widthM = distanceMeters([bbox[0], centroid[1]], [bbox[2], centroid[1]]);
  const heightM = distanceMeters([centroid[0], bbox[1]], [centroid[0], bbox[3]]);
  const parcelAreaSqM = widthM * heightM * 0.8;
  const parcelAcres = parcelAreaSqM / 4046.86;
  
  console.log('[TerrainFlow] Synthetic generation for ~', Math.round(parcelAcres), 'acres');
  
  // Determine dominant axis for flow direction
  const isNorthSouth = heightM > widthM;
  const primaryBearing = isNorthSouth ? 0 : 90; // N-S or E-W
  
  // Generate primary flow lines (2-4 based on parcel size)
  const primaryLines: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  const numPrimary = Math.min(4, Math.max(2, Math.floor(parcelAcres / 30)));
  
  for (let i = 0; i < numPrimary; i++) {
    const offset = (i - (numPrimary - 1) / 2) * (isNorthSouth ? widthM : heightM) / (numPrimary + 1);
    const line = generateFlowLine(
      centroid,
      primaryBearing,
      Math.min(isNorthSouth ? heightM : widthM, 800) * 0.8,
      offset,
      isNorthSouth,
      'primary'
    );
    if (line) primaryLines.push(line);
  }
  
  // Generate secondary flow lines (3-6 based on parcel size)
  const secondaryLines: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  const numSecondary = Math.min(6, Math.max(3, Math.floor(parcelAcres / 20)));
  
  for (let i = 0; i < numSecondary; i++) {
    const offset = (i - (numSecondary - 1) / 2) * (isNorthSouth ? widthM : heightM) / (numSecondary + 1);
    // Secondary flows at slight angles
    const angle = primaryBearing + (Math.random() - 0.5) * 40;
    const line = generateFlowLine(
      centroid,
      angle,
      Math.min(isNorthSouth ? heightM : widthM, 500) * 0.6,
      offset,
      isNorthSouth,
      'secondary'
    );
    if (line) secondaryLines.push(line);
  }
  
  // Generate convergence zones (1-3 based on parcel complexity)
  const convergenceZones: GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[] = [];
  const numConvergence = Math.min(3, Math.max(1, Math.floor(parcelAcres / 40)));
  
  for (let i = 0; i < numConvergence; i++) {
    const offsetLng = (Math.random() - 0.5) * (bbox[2] - bbox[0]) * 0.6;
    const offsetLat = (Math.random() - 0.5) * (bbox[3] - bbox[1]) * 0.6;
    const point: [number, number] = [centroid[0] + offsetLng, centroid[1] + offsetLat];
    
    convergenceZones.push({
      type: 'Feature',
      properties: {
        id: `conv_${i}`,
        intensity: 0.65 + Math.random() * 0.25,
        flowCount: 2 + Math.floor(Math.random() * 2),
        radiusM: 30 + Math.random() * 40,
        type: i === 0 ? 'pinch' : 'overlap',
      },
      geometry: {
        type: 'Point',
        coordinates: point,
      },
    });
  }
  
  // Generate opportunity zones (0-2 at high convergence)
  const opportunityZones: GeoJSON.Feature<GeoJSON.Point, OpportunityZoneProperties>[] = [];
  if (convergenceZones.length > 0 && parcelAcres >= 20) {
    const topConvergence = convergenceZones[0];
    opportunityZones.push({
      type: 'Feature',
      properties: {
        id: 'opp_1',
        score: 0.75 + Math.random() * 0.15,
        flowIntensity: topConvergence.properties.intensity,
        convergenceBonus: 0.15,
        benchBonus: 0.10,
        saddleBonus: 0.05,
        radiusM: 25,
      },
      geometry: topConvergence.geometry,
    });
  }
  
  const processingTime = (Date.now() - startTime) / 1000;
  
  return {
    success: true,
    bbox,
    flow_primary: { type: 'FeatureCollection', features: primaryLines },
    flow_secondary: { type: 'FeatureCollection', features: secondaryLines },
    convergence_zones: { type: 'FeatureCollection', features: convergenceZones },
    opportunity_zones: { type: 'FeatureCollection', features: opportunityZones },
    metadata: {
      processing_time_seconds: processingTime,
      mode: 'synthetic',
      dem_source: 'GEOMETRY_BASED',
      resolution_m: 0,
      weights: FLOW_WEIGHTS,
      thresholds: FLOW_THRESHOLDS,
      stats: {
        flow_count_primary: primaryLines.length,
        flow_count_secondary: secondaryLines.length,
        convergence_count: convergenceZones.length,
        opportunity_count: opportunityZones.length,
        total_flow_length_m: 0,
        coverage_pct: 0,
      },
      fallback_reason: 'Synthetic generation - real DEM terrain flow analysis pending',
    },
  };
}

/**
 * Generate a single flow line
 */
function generateFlowLine(
  center: [number, number],
  bearing: number,
  length: number,
  offset: number,
  isNorthSouth: boolean,
  tier: FlowTier
): GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties> | null {
  // Apply offset perpendicular to bearing
  const offsetBearing = bearing + 90;
  const offsetPoint = movePoint(center, offsetBearing, offset);
  
  // Create line points with gentle curves
  const numPoints = 8;
  const coords: [number, number][] = [];
  
  for (let i = 0; i < numPoints; i++) {
    const t = (i / (numPoints - 1)) - 0.5; // -0.5 to 0.5
    const dist = t * length;
    // Add slight sinusoidal variation for natural appearance
    const lateralVar = Math.sin(t * Math.PI * 2) * (length * 0.03);
    const point = movePoint(offsetPoint, bearing, dist);
    const finalPoint = movePoint(point, bearing + 90, lateralVar);
    coords.push(finalPoint);
  }
  
  const lineLength = coords.reduce((sum, coord, i) => {
    if (i === 0) return 0;
    return sum + distanceMeters(coords[i - 1], coord);
  }, 0);
  
  return {
    type: 'Feature',
    properties: {
      id: `flow_${tier}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      tier,
      likelihood: tier === 'primary' ? 0.80 + Math.random() * 0.15 : 0.60 + Math.random() * 0.15,
      lengthM: Math.round(lineLength),
      avgSlope: 8 + Math.random() * 6,
      convergenceScore: 0.5 + Math.random() * 0.3,
    },
    geometry: {
      type: 'LineString',
      coordinates: coords,
    },
  };
}

/**
 * Create empty flow response for error cases
 */
function emptyFlowResponse(reason: string): TerrainFlowResponse {
  return {
    success: false,
    bbox: [0, 0, 0, 0],
    flow_primary: { type: 'FeatureCollection', features: [] },
    flow_secondary: { type: 'FeatureCollection', features: [] },
    convergence_zones: { type: 'FeatureCollection', features: [] },
    opportunity_zones: { type: 'FeatureCollection', features: [] },
    metadata: {
      processing_time_seconds: 0,
      mode: 'error',
      dem_source: 'NONE',
      resolution_m: 0,
      weights: FLOW_WEIGHTS,
      thresholds: FLOW_THRESHOLDS,
      stats: {
        flow_count_primary: 0,
        flow_count_secondary: 0,
        convergence_count: 0,
        opportunity_count: 0,
        total_flow_length_m: 0,
        coverage_pct: 0,
      },
      fallback_reason: reason,
    },
  };
}
