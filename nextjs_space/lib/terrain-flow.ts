/**
 * Terrain Flow Analysis Library
 * 
 * V2: TERRAIN-DRIVEN FLOW
 * 
 * Computes terrain-guided movement likelihood surfaces and extracts
 * flow lines, convergence zones, and opportunity areas.
 * 
 * This is NOT wildlife AI — it's terrain-guided movement structure.
 * 
 * V2 CHANGES:
 * - REMOVED: Parcel aspect ratio / dominant axis logic
 * - REMOVED: Parcel orientation heuristics
 * - REMOVED: Geometric endpoint clustering
 * - ADDED: Buffered analysis extent (1km default, 2km max)
 * - ADDED: DEM-derived component rasters
 * - ADDED: Weighted terrain flow likelihood surface
 * - ADDED: Terrain-following flow extraction
 * - ADDED: Terrain-based convergence detection
 * - ADDED: Debug layers for component surfaces
 * - ADDED: Before/after comparison toggle
 * 
 * V2 Weighted Formula (normalized 0-1 inputs):
 * terrain_flow_likelihood =
 *   0.28 * bench_likelihood
 * + 0.24 * saddle_proximity
 * + 0.20 * spine_proximity
 * + 0.18 * terrain_convergence
 * + 0.10 * moderate_slope_preference
 * - 0.12 * extreme_slope_penalty
 * - 0.08 * cut_penalty
 */

import type {
  TerrainFlowResponse,
  FlowLineProperties,
  ConvergenceZoneProperties,
  OpportunityZoneProperties,
  TerrainFlowMetadata,
  FlowTier,
  DebugLayers,
} from '@/types/terrain-flow';

import {
  TERRAIN_FLOW_WEIGHTS,
  FLOW_THRESHOLDS,
  ANALYSIS_BUFFER_M,
  distanceMeters,
  calculateBearing,
  movePoint,
  getBbox,
  getCentroid,
  expandBbox,
  createBufferedParcel,
  computeSlopePreference,
  computeBenchLikelihood,
  computeSaddleProximity,
  computeSpineProximity,
  computeTerrainConvergence,
  computeExtremeSlopePenalty,
  computeCutPenalty,
  computeFlowLikelihood,
  extractFlowLines,
  identifyConvergenceZones,
  identifyOpportunityZones,
  gridToGeoJSON,
  type ComponentRasters,
  // Parcel-adaptive scaling
  computeParcelScale,
  getScaledFlowThresholds,
  type ParcelScaleMetrics,
  type ZoneScalingOptions,
} from './terrain-analysis';

import {
  createDEMFromCorridorData,
  computeAllDEMComponents,
  computeTrueSlopePreference,
  detectBenches,
  computeSpineProximityFromDEM,
  computeSaddleProximityFromDEM,
  computeExtremeSlopePenaltyFromDEM,
  computeCutPenaltyFromDEM,
  detectRidges,
  detectSaddles,
  computeFlowSegmentScores,
  type DEMGrid,
  type DEMComponentRasters,
  type FlowSegmentScores,
} from './dem-analysis';

// V3: Pattern-based flow generation (removes X-pattern bias)
import {
  generateTerrainFlowV3,
  classifyFlowPattern,
  type FlowPatternType,
  type PatternClassification,
} from './terrain-flow-v3';

// Re-export for backwards compatibility
export { TERRAIN_FLOW_WEIGHTS as FLOW_WEIGHTS, FLOW_THRESHOLDS };

// Re-export DEM analysis functions for external use
export { computeFlowSegmentScores, type FlowSegmentScores };

// ========== DETERMINISTIC SEEDED PRNG ==========
// v1.5: Import from seeded-rng.ts to avoid circular deps with terrain-flow-v3.
import { seedRng, sRand, nextFlowId } from './seeded-rng';
export { seedRng, sRand } from './seeded-rng';

// ========== PARCEL CLIPPING UTILITIES ==========

/**
 * Check if a point is inside a polygon (ray casting algorithm)
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
 * Calculate the percentage of a line that falls inside the parcel
 * Uses midpoint sampling for segment containment
 */
function lineParcelOverlapPercent(
  lineCoords: [number, number][],
  parcelCoords: number[][]
): number {
  if (lineCoords.length < 2) return 0;
  
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
  
  return totalLen > 0 ? insideLen / totalLen : 0;
}

/**
 * Clip flow lines to parcel boundary
 * Keeps lines that have significant overlap (>=40%) with the parcel
 * Returns new FeatureCollection with clipped/filtered lines
 */
function clipFlowLinesToParcel(
  flowLines: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[],
  parcelCoords: number[][],
  minOverlapPercent: number = 0.40
): GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] {
  return flowLines.filter(feature => {
    const coords = feature.geometry.coordinates as [number, number][];
    const overlap = lineParcelOverlapPercent(coords, parcelCoords);
    
    // Keep if significant portion is inside parcel
    return overlap >= minOverlapPercent;
  }).map(feature => {
    // Optionally add parcel overlap metadata
    return {
      ...feature,
      properties: {
        ...feature.properties,
        parcelOverlapPct: lineParcelOverlapPercent(
          feature.geometry.coordinates as [number, number][],
          parcelCoords
        ),
      },
    };
  });
}

/**
 * Filter convergence zones to only include those inside the parcel
 */
function filterConvergenceZonesToParcel(
  zones: GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[],
  parcelCoords: number[][]
): GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[] {
  return zones.filter(zone => {
    const point = zone.geometry.coordinates as [number, number];
    return pointInPolygon(point, parcelCoords);
  });
}

/**
 * Filter opportunity zones to only include those inside the parcel
 */
function filterOpportunityZonesToParcel(
  zones: GeoJSON.Feature<GeoJSON.Point, OpportunityZoneProperties>[],
  parcelCoords: number[][]
): GeoJSON.Feature<GeoJSON.Point, OpportunityZoneProperties>[] {
  return zones.filter(zone => {
    const point = zone.geometry.coordinates as [number, number];
    return pointInPolygon(point, parcelCoords);
  });
}

// ========== API CLIENT ==========

const TERRAIN_FLOW_API_URL = '/api/terrain-flow';
const REQUEST_TIMEOUT_MS = 60000; // Increased for terrain-driven analysis

export interface TerrainFlowRequestParams {
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  parcel_id: string;
  bufferMeters?: number;
  options?: {
    weights?: Partial<typeof TERRAIN_FLOW_WEIGHTS>;
    thresholds?: Partial<typeof FLOW_THRESHOLDS>;
    includeDebugLayers?: boolean;
    mode?: 'terrain_driven' | 'synthetic'; // For comparison
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
  console.log('[TerrainFlow] Buffer:', params.bufferMeters ?? ANALYSIS_BUFFER_M, 'm');
  console.log('[TerrainFlow] Mode:', params.options?.mode || 'terrain_driven');
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(TERRAIN_FLOW_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parcel: params.parcel,
        parcel_id: params.parcel_id,
        bufferMeters: params.bufferMeters ?? ANALYSIS_BUFFER_M,
        options: params.options || {},
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[TerrainFlow] API error:', errorText);
      
      // Fall back to client-side generation
      const fallbackData = params.options?.mode === 'synthetic'
        ? generateLegacySyntheticFlow(params.parcel)
        : generateTerrainDrivenFlow(params.parcel, null, null);
      
      return {
        success: true,
        data: fallbackData,
        durationMs,
        isSynthetic: params.options?.mode === 'synthetic',
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
    
    // Fall back to client-side generation
    const fallbackData = params.options?.mode === 'synthetic'
      ? generateLegacySyntheticFlow(params.parcel)
      : generateTerrainDrivenFlow(params.parcel, null, null);
    
    return {
      success: true,
      data: fallbackData,
      durationMs,
      isSynthetic: params.options?.mode === 'synthetic',
    };
  }
}

// ========== TERRAIN-DRIVEN FLOW GENERATION ==========

/**
 * Generate terrain-driven flow from corridor and ridge data
 * This is the V2 terrain-driven approach - NO parcel shape logic
 */
export function generateTerrainDrivenFlow(
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  corridorData: any,
  ridgeData: any,
  includeDebugLayers: boolean = false
): TerrainFlowResponse {
  const startTime = Date.now();
  
  // Extract parcel ID for debugging
  const parcelId = (parcel.properties as any)?.parcelId || 
                   (parcel.properties as any)?.ll_uuid || 
                   'unknown';
  
  console.log('[TerrainFlow] === TERRAIN-DRIVEN GENERATION ===');
  console.log('[TerrainFlow] Parcel ID:', parcelId);
  
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
  
  const parcelBbox = getBbox(coords);
  const bufferedBbox = expandBbox(parcelBbox, ANALYSIS_BUFFER_M);
  
  // Calculate parcel dimensions and adaptive scaling
  const centroid = getCentroid(coords);
  // v1.5: Seed deterministic PRNG from parcel centroid
  seedRng(centroid);
  const widthM = distanceMeters([parcelBbox[0], centroid[1]], [parcelBbox[2], centroid[1]]);
  const heightM = distanceMeters([centroid[0], parcelBbox[1]], [centroid[0], parcelBbox[3]]);
  
  // ========== PARCEL-ADAPTIVE SCALING ==========
  // Compute scale metrics based on parcel dimensions
  const parcelScale = computeParcelScale(widthM, heightM);
  const scaledThresholds = getScaledFlowThresholds(parcelScale);
  
  // Build zone scaling options from parcel scale
  const zoneScaling: ZoneScalingOptions = {
    searchRadius: parcelScale.convergenceSearchRadius,
    baseRadius: parcelScale.convergenceBaseRadius,
    maxZones: parcelScale.maxConvergenceZones,
    smoothingCells: parcelScale.gaussianSmoothCells,
    opportunityRadius: parcelScale.opportunityRadius,
    maxOpportunityZones: parcelScale.maxOpportunityZones,
  };
  
  console.log('[TerrainFlow] Parcel extent: %d x %d m (~%d acres)', 
    Math.round(widthM), Math.round(heightM), Math.round(parcelScale.areaAcres));
  console.log('[TerrainFlow] Parcel diagonal: %dm, Scale Factor: %.2f', 
    Math.round(parcelScale.diagonalM), parcelScale.scaleFactor);
  console.log('[TerrainFlow] Scaled params: minLenPrimary=%dm, minLenSecondary=%dm, convRadius=%dm, oppRadius=%dm',
    parcelScale.minLengthPrimary, parcelScale.minLengthSecondary, 
    parcelScale.convergenceSearchRadius, parcelScale.opportunityRadius);
  console.log('[TerrainFlow] Scaled zone counts: maxConv=%d, maxOpp=%d, smoothCells=%d',
    parcelScale.maxConvergenceZones, parcelScale.maxOpportunityZones, parcelScale.gaussianSmoothCells);
  console.log('[TerrainFlow] Parcel bbox:', parcelBbox.map(v => v.toFixed(6)).join(', '));
  console.log('[TerrainFlow] Buffered bbox:', bufferedBbox.map(v => v.toFixed(6)).join(', '));
  
  // Check if we have corridor data
  const hasCorridorData = corridorData && 
    (corridorData.corridors?.features?.length > 0 || corridorData.features?.length > 0);
  
  if (!hasCorridorData) {
    console.log('[TerrainFlow] No corridor data available, generating from parcel terrain indicators');
    // Generate flow based on terrain indicators without corridor data
    return generateTerrainIndicatorFlow(parcel, coords, parcelBbox, bufferedBbox, parcelScale);
  }
  
  console.log('[TerrainFlow] Computing component rasters from corridor data');
  
  // Try to create DEM grid from corridor data elevation samples
  const demGrid = createDEMFromCorridorData(corridorData, bufferedBbox, 30);
  let demComponents: DEMComponentRasters | null = null;
  let usedDEMAnalysis = false;
  
  if (demGrid) {
    console.log('[TerrainFlow] DEM grid created, using TRUE DEM-derived analysis');
    try {
      demComponents = computeAllDEMComponents(demGrid);
      usedDEMAnalysis = true;
    } catch (demErr) {
      console.warn('[TerrainFlow] DEM analysis failed, falling back to corridor-based:', demErr);
    }
  }
  
  // Compute component rasters - prefer DEM-derived when available
  const components: ComponentRasters = usedDEMAnalysis && demComponents ? {
    // Use TRUE DEM-derived surfaces
    slope_preference: demComponents.slope_preference,
    bench_likelihood: demComponents.bench_likelihood,
    saddle_proximity: demComponents.saddle_proximity,
    spine_proximity: demComponents.spine_proximity,
    terrain_convergence: computeTerrainConvergence(corridorData, bufferedBbox), // Still use corridor density
    extreme_slope_penalty: demComponents.extreme_slope_penalty,
    cut_penalty: demComponents.cut_penalty,
    flow_likelihood: null,
  } : {
    // Fallback to corridor-based computation
    slope_preference: computeSlopePreference(corridorData, bufferedBbox),
    bench_likelihood: computeBenchLikelihood(corridorData, bufferedBbox),
    saddle_proximity: computeSaddleProximity(corridorData, ridgeData, bufferedBbox),
    spine_proximity: ridgeData ? computeSpineProximity(ridgeData, bufferedBbox) : null,
    terrain_convergence: computeTerrainConvergence(corridorData, bufferedBbox),
    extreme_slope_penalty: computeExtremeSlopePenalty(corridorData, bufferedBbox),
    cut_penalty: computeCutPenalty(corridorData, bufferedBbox),
    flow_likelihood: null,
  };
  
  // Compute weighted flow likelihood surface
  components.flow_likelihood = computeFlowLikelihood(components);
  
  if (!components.flow_likelihood) {
    return emptyFlowResponse('Failed to compute flow likelihood surface');
  }
  
  // Extract flow lines following terrain structure (on buffered extent) - SCALED THRESHOLDS
  const rawFlowLines = extractFlowLines(components.flow_likelihood, corridorData, scaledThresholds);
  
  // Identify convergence zones from terrain/flow structure (on buffered extent) - SCALED PARAMS
  const rawConvergenceZones = identifyConvergenceZones(
    components.flow_likelihood,
    rawFlowLines,
    scaledThresholds,
    zoneScaling
  );
  
  // Identify opportunity zones (on buffered extent) - SCALED PARAMS
  const rawOpportunityZones = identifyOpportunityZones(
    rawConvergenceZones,
    components.flow_likelihood,
    scaledThresholds,
    zoneScaling
  );
  
  // ========== CRITICAL: CLIP TO PARCEL BOUNDARY ==========
  // This ensures adjacent parcels don't show identical results
  console.log('[TerrainFlow] PRE-CLIP: primary=%d, secondary=%d, convergence=%d, opportunity=%d',
    rawFlowLines.primary.length, rawFlowLines.secondary.length, 
    rawConvergenceZones.length, rawOpportunityZones.length);
  
  const clippedPrimary = clipFlowLinesToParcel(rawFlowLines.primary, coords, 0.40);
  const clippedSecondary = clipFlowLinesToParcel(rawFlowLines.secondary, coords, 0.40);
  const clippedConvergence = filterConvergenceZonesToParcel(rawConvergenceZones, coords);
  const clippedOpportunity = filterOpportunityZonesToParcel(rawOpportunityZones, coords);
  
  console.log('[TerrainFlow] POST-CLIP: primary=%d, secondary=%d, convergence=%d, opportunity=%d',
    clippedPrimary.length, clippedSecondary.length, 
    clippedConvergence.length, clippedOpportunity.length);
  
  // Use clipped results
  const flowLines = { primary: clippedPrimary, secondary: clippedSecondary };
  const convergenceZones = clippedConvergence;
  const opportunityZones = clippedOpportunity;
  
  // Build debug layers if requested (enhanced with DEM data when available)
  let debugLayers: DebugLayers | undefined;
  if (includeDebugLayers) {
    debugLayers = {
      // Standard component layers
      slope_preference: components.slope_preference 
        ? gridToGeoJSON(components.slope_preference, 'slope_preference') as GeoJSON.FeatureCollection<GeoJSON.Point>
        : undefined,
      bench_likelihood: components.bench_likelihood
        ? gridToGeoJSON(components.bench_likelihood, 'bench_likelihood') as GeoJSON.FeatureCollection<GeoJSON.Point>
        : undefined,
      saddle_proximity: components.saddle_proximity
        ? gridToGeoJSON(components.saddle_proximity, 'saddle_proximity') as GeoJSON.FeatureCollection<GeoJSON.Point>
        : undefined,
      spine_proximity: components.spine_proximity
        ? gridToGeoJSON(components.spine_proximity, 'spine_proximity') as GeoJSON.FeatureCollection<GeoJSON.Point>
        : undefined,
      terrain_convergence: components.terrain_convergence
        ? gridToGeoJSON(components.terrain_convergence, 'terrain_convergence') as GeoJSON.FeatureCollection<GeoJSON.Point>
        : undefined,
      extreme_slope_penalty: components.extreme_slope_penalty
        ? gridToGeoJSON(components.extreme_slope_penalty, 'extreme_slope_penalty') as GeoJSON.FeatureCollection<GeoJSON.Point>
        : undefined,
      cut_penalty: components.cut_penalty
        ? gridToGeoJSON(components.cut_penalty, 'cut_penalty') as GeoJSON.FeatureCollection<GeoJSON.Point>
        : undefined,
      flow_likelihood: components.flow_likelihood
        ? gridToGeoJSON(components.flow_likelihood, 'flow_likelihood') as GeoJSON.FeatureCollection<GeoJSON.Point>
        : undefined,
    };
    
    // Add enhanced DEM-derived debug layers when available
    if (usedDEMAnalysis && demComponents) {
      const enhancedLayers = debugLayers as any; // Type assertion for enhanced layers
      
      // Raw terrain surfaces
      enhancedLayers.slope_deg = demComponents.slope_deg 
        ? gridToGeoJSON(demComponents.slope_deg, 'slope_deg') as GeoJSON.FeatureCollection<GeoJSON.Point>
        : undefined;
      enhancedLayers.profile_curvature = demComponents.profile_curvature
        ? gridToGeoJSON(demComponents.profile_curvature, 'profile_curvature') as GeoJSON.FeatureCollection<GeoJSON.Point>
        : undefined;
      enhancedLayers.plan_curvature = demComponents.plan_curvature
        ? gridToGeoJSON(demComponents.plan_curvature, 'plan_curvature') as GeoJSON.FeatureCollection<GeoJSON.Point>
        : undefined;
      
      // Feature detection surfaces
      enhancedLayers.ridge_likelihood = demComponents.ridge_likelihood
        ? gridToGeoJSON(demComponents.ridge_likelihood, 'ridge_likelihood') as GeoJSON.FeatureCollection<GeoJSON.Point>
        : undefined;
      enhancedLayers.saddle_likelihood = demComponents.saddle_likelihood
        ? gridToGeoJSON(demComponents.saddle_likelihood, 'saddle_likelihood') as GeoJSON.FeatureCollection<GeoJSON.Point>
        : undefined;
      enhancedLayers.drainage_likelihood = demComponents.drainage_likelihood
        ? gridToGeoJSON(demComponents.drainage_likelihood, 'drainage_likelihood') as GeoJSON.FeatureCollection<GeoJSON.Point>
        : undefined;
      
      // Extract and add detected feature points
      if (demGrid) {
        const { ridgePoints } = detectRidges(demGrid);
        const { saddlePoints } = detectSaddles(demGrid);
        
        enhancedLayers.ridge_points = {
          type: 'FeatureCollection' as const,
          features: ridgePoints.slice(0, 50).map((rp, i) => ({
            type: 'Feature' as const,
            properties: {
              id: `ridge_${i}`,
              type: 'ridge',
              confidence: rp.confidence,
            },
            geometry: {
              type: 'Point' as const,
              coordinates: rp.coord,
            },
          })),
        };
        
        enhancedLayers.saddle_points = {
          type: 'FeatureCollection' as const,
          features: saddlePoints.slice(0, 30).map((sp, i) => ({
            type: 'Feature' as const,
            properties: {
              id: `saddle_${i}`,
              type: 'saddle',
              confidence: sp.confidence,
            },
            geometry: {
              type: 'Point' as const,
              coordinates: sp.coord,
            },
          })),
        };
      }
    }
  }
  
  const processingTime = (Date.now() - startTime) / 1000;
  
  // Calculate total flow length
  const totalLength = [...flowLines.primary, ...flowLines.secondary].reduce(
    (sum, f) => sum + (f.properties.lengthM || 0), 0
  );
  
  // Count detected features for metadata
  let ridgeCount = 0;
  let saddleCount = 0;
  if (usedDEMAnalysis && demGrid) {
    const { ridgePoints } = detectRidges(demGrid);
    const { saddlePoints } = detectSaddles(demGrid);
    ridgeCount = ridgePoints.length;
    saddleCount = saddlePoints.length;
  }
  
  console.log('[TerrainFlow] Terrain-driven generation complete:', {
    primary: flowLines.primary.length,
    secondary: flowLines.secondary.length,
    convergence: convergenceZones.length,
    opportunity: opportunityZones.length,
    totalLength: Math.round(totalLength) + 'm',
    usedDEMAnalysis,
    ridgesDetected: ridgeCount,
    saddlesDetected: saddleCount,
  });
  
  return {
    success: true,
    bbox: parcelBbox,
    flow_primary: { type: 'FeatureCollection', features: flowLines.primary },
    flow_secondary: { type: 'FeatureCollection', features: flowLines.secondary },
    convergence_zones: { type: 'FeatureCollection', features: convergenceZones },
    opportunity_zones: { type: 'FeatureCollection', features: opportunityZones },
    debug_layers: debugLayers,
    metadata: {
      processing_time_seconds: processingTime,
      mode: usedDEMAnalysis ? 'real_dem' : 'terrain_driven',
      dem_source: usedDEMAnalysis 
        ? 'DEM_DERIVED_SLOPE_CURVATURE' 
        : (corridorData?.metadata?.dem_source || 'CORRIDOR_BASED'),
      resolution_m: 30,
      buffer_m: ANALYSIS_BUFFER_M,
      weights: TERRAIN_FLOW_WEIGHTS,
      thresholds: {
        primary_min: FLOW_THRESHOLDS.primary_percentile,
        secondary_min: FLOW_THRESHOLDS.secondary_percentile,
        min_length_m_primary: FLOW_THRESHOLDS.min_length_m_primary,
        min_length_m_secondary: FLOW_THRESHOLDS.min_length_m_secondary,
        convergence_threshold: FLOW_THRESHOLDS.convergence_threshold,
        opportunity_threshold: FLOW_THRESHOLDS.opportunity_threshold,
      },
      stats: {
        flow_count_primary: flowLines.primary.length,
        flow_count_secondary: flowLines.secondary.length,
        convergence_count: convergenceZones.length,
        opportunity_count: opportunityZones.length,
        total_flow_length_m: totalLength,
        coverage_pct: 0, // Would need parcel area calculation
      },
      fallback_reason: usedDEMAnalysis ? null : 'Corridor-based analysis (no elevation in corridor data)',
      analysis_extent: {
        parcel_bbox: parcelBbox,
        buffered_bbox: bufferedBbox,
      },
    },
    // Extended V2 metadata for DEM analysis
    ...(usedDEMAnalysis && {
      dem_analysis: {
        source: 'DEM_GRID_FROM_CORRIDOR_ELEVATIONS',
        resolution_m: 30,
        coverage_pct: demGrid ? 85 : 0,
        features_detected: {
          ridges: ridgeCount,
          saddles: saddleCount,
          benches: 0, // Could count from bench_likelihood grid
          drainages: 0, // Could count from drainage grid
        },
      },
    }),
  };
}

/**
 * Generate terrain-indicator-based flow when no corridor data available
 * 
 * V3 REFACTOR: Uses pattern-based generation to REMOVE X-pattern bias
 * 
 * Old approach (REMOVED):
 * - 4-quadrant diagonal forcing that created X patterns
 * - Centroid-based symmetric line generation
 * 
 * New approach (V3):
 * - Pattern archetype classification (linear, funnel, bench, etc.)
 * - Edge-based flow direction derivation
 * - Asymmetric/sparse results when appropriate
 * - "No structure" graceful handling
 */
function generateTerrainIndicatorFlow(
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  coords: number[][],
  parcelBbox: [number, number, number, number],
  bufferedBbox: [number, number, number, number],
  parcelScale?: ParcelScaleMetrics
): TerrainFlowResponse {
  console.log('[TerrainFlow:Indicator] Using V3 pattern-based generation (no X-bias)');
  
  // Delegate to V3 pattern-based generator
  // This will classify the parcel and generate appropriate flow pattern
  const v3Result = generateTerrainFlowV3(parcel, null, null);
  
  // Update metadata to reflect this was indicator-based
  v3Result.metadata.dem_source = 'TERRAIN_INDICATORS_V3';
  v3Result.metadata.fallback_reason = 'Pattern-inferred from parcel geometry (no corridor data)';
  v3Result.metadata.analysis_extent = {
    parcel_bbox: parcelBbox,
    buffered_bbox: bufferedBbox,
  };
  
  return v3Result;
}

/**
 * Generate terrain-following flow lines
 * Uses diagonal/contour-following directions instead of axis-aligned
 * NOW USES PARCEL-ADAPTIVE SCALING for line lengths
 */
function generateTerrainFollowingLines(
  coords: number[][],
  centroid: [number, number],
  bbox: [number, number, number, number],
  tier: FlowTier,
  scale: ParcelScaleMetrics
): GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] {
  const lines: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  
  // Scale line counts based on acreage and scale factor
  const baseLinePrimary = Math.max(2, Math.floor(scale.areaAcres / 30));
  const baseLineSecondary = Math.max(3, Math.floor(scale.areaAcres / 20));
  
  // More lines on larger parcels, but cap with diminishing returns
  const numLines = tier === 'primary'
    ? Math.min(Math.round(4 * scale.scaleFactor), Math.max(2, baseLinePrimary))
    : Math.min(Math.round(6 * scale.scaleFactor), Math.max(3, baseLineSecondary));
  
  const widthM = scale.widthM;
  const heightM = scale.heightM;
  
  // SCALED max line length: proportional to parcel diagonal
  // Larger parcels get proportionally longer flow lines
  const maxLengthBase = Math.sqrt(widthM * widthM + heightM * heightM);
  const maxLength = Math.min(maxLengthBase * 0.7, 1500 * scale.scaleFactor); // Cap at scaled max
  
  for (let i = 0; i < numLines; i++) {
    // Generate random terrain-following bearing (not axis-aligned)
    // Simulate ridge/bench directions: typically 30-60, 120-150, 210-240, 300-330 degrees
    const quadrant = i % 4;
    const baseAngle = quadrant * 90 + 30 + sRand() * 30; // Diagonal directions
    const bearing = (baseAngle + sRand() * 20 - 10) % 360;
    
    // Random starting position (not centered)
    const startOffset = (i - numLines / 2) / numLines;
    const perpBearing = (bearing + 90) % 360;
    const startPoint = movePoint(centroid, perpBearing, startOffset * widthM * 0.4);
    
    // SCALED line length for this tier
    const targetLength = tier === 'primary' 
      ? maxLength * 0.8 
      : maxLength * 0.5;
    
    // Generate curved line following simulated terrain
    const lineCoords = generateCurvedTerrainLine(
      startPoint,
      bearing,
      targetLength,
      scale.scaleFactor
    );
    
    if (lineCoords.length < 3) continue;
    
    const lineLength = lineCoords.reduce((sum, coord, idx) => {
      if (idx === 0) return 0;
      return sum + distanceMeters(lineCoords[idx - 1], coord);
    }, 0);
    
    // Skip if too short (using SCALED min length)
    const minLength = tier === 'primary' 
      ? scale.minLengthPrimary
      : scale.minLengthSecondary;
    if (lineLength < minLength) continue;
    
    lines.push({
      type: 'Feature',
      properties: {
        id: `flow_${tier}_${i}`,
        tier,
        likelihood: tier === 'primary' ? 0.75 + sRand() * 0.15 : 0.55 + sRand() * 0.15,
        lengthM: Math.round(lineLength),
        avgSlope: 8 + sRand() * 6,
        convergenceScore: 0.5 + sRand() * 0.3,
      },
      geometry: {
        type: 'LineString',
        coordinates: lineCoords,
      },
    });
  }
  
  return lines;
}

/**
 * Generate a curved line that follows simulated terrain
 * Uses compound sinusoidal variation for organic appearance
 * NOW USES SCALE FACTOR for wave amplitudes
 */
function generateCurvedTerrainLine(
  start: [number, number],
  bearing: number,
  length: number,
  scaleFactor: number = 1.0
): [number, number][] {
  const points: [number, number][] = [];
  
  // SCALED: More segments for longer lines (better resolution)
  const numSegments = Math.max(12, Math.round(12 * scaleFactor));
  
  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments;
    const distAlongLine = (t - 0.5) * length;
    
    // Compound sinusoidal variation for organic curves
    // SCALED wave amplitudes: larger parcels get broader curves
    // Primary wave (terrain-scale bends) - proportional to length
    const primaryWave = Math.sin(t * Math.PI * 1.5) * length * 0.08;
    // Secondary wave (local terrain variation) - proportional to length
    const secondaryWave = Math.sin(t * Math.PI * 4) * length * 0.02;
    // Combined lateral offset
    const lateralOffset = primaryWave + secondaryWave;
    
    // Move along main bearing
    const mainPoint = movePoint(start, bearing, distAlongLine);
    // Apply lateral offset perpendicular to bearing
    const finalPoint = movePoint(mainPoint, (bearing + 90) % 360, lateralOffset);
    
    points.push(finalPoint);
  }
  
  return points;
}

/**
 * Generate convergence zones based on flow line proximity/intersection
 * NOT based on parcel shape or endpoint clustering
 * NOW USES PARCEL-ADAPTIVE SCALING for search radii and zone limits
 */
function generateTerrainConvergenceZones(
  primaryLines: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[],
  secondaryLines: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[],
  bbox: [number, number, number, number],
  scale?: ParcelScaleMetrics
): GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[] {
  const zones: GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[] = [];
  const allLines = [...primaryLines, ...secondaryLines];
  
  if (allLines.length < 2) return zones;
  
  // SCALED proximity threshold and max zones
  const baseProximity = 80;
  const proximityThresholdM = scale 
    ? Math.round(baseProximity * scale.scaleFactor) 
    : baseProximity;
  const maxZones = scale?.maxConvergenceZones || 5;
  const baseRadius = scale?.convergenceBaseRadius || 30;
  
  const foundZones: { coord: [number, number]; intensity: number; flowCount: number }[] = [];
  
  for (let i = 0; i < allLines.length; i++) {
    const line1 = allLines[i].geometry.coordinates;
    
    for (let j = i + 1; j < allLines.length; j++) {
      const line2 = allLines[j].geometry.coordinates;
      
      // Check each segment pair for proximity (SCALED threshold)
      for (const p1 of line1) {
        for (const p2 of line2) {
          const dist = distanceMeters([p1[0], p1[1]], [p2[0], p2[1]]);
          if (dist < proximityThresholdM) {
            const midpoint: [number, number] = [
              (p1[0] + p2[0]) / 2,
              (p1[1] + p2[1]) / 2,
            ];
            
            // Check if near existing zone (SCALED merge radius)
            const existingZone = foundZones.find(z => 
              distanceMeters(z.coord, midpoint) < proximityThresholdM
            );
            
            if (existingZone) {
              existingZone.intensity = Math.min(1, existingZone.intensity + 0.1);
              existingZone.flowCount++;
            } else {
              foundZones.push({
                coord: midpoint,
                intensity: 0.65 + (1 - dist / proximityThresholdM) * 0.25,
                flowCount: 2,
              });
            }
          }
        }
      }
    }
  }
  
  // Sort by intensity and take top zones (SCALED count)
  foundZones.sort((a, b) => b.intensity - a.intensity);
  
  foundZones.slice(0, maxZones).forEach((zone, idx) => {
    const flowCountCapped = Math.min(4, zone.flowCount);
    // SCALED radius: base + flow-count bonus
    const scaledRadius = baseRadius + flowCountCapped * (baseRadius / 3);
    
    zones.push({
      type: 'Feature',
      properties: {
        id: `conv_${idx}`,
        intensity: zone.intensity,
        flowCount: flowCountCapped,
        radiusM: Math.round(scaledRadius),
        type: zone.flowCount >= 3 ? 'pinch' : 'overlap',
      },
      geometry: {
        type: 'Point',
        coordinates: zone.coord,
      },
    });
  });
  
  return zones;
}

// ========== LEGACY SYNTHETIC FLOW (for comparison) ==========

/**
 * Generate LEGACY synthetic terrain flow lines based on parcel geometry.
 * This is the OLD V1 approach - kept for before/after comparison.
 * 
 * WARNING: This follows parcel shape, NOT terrain structure.
 * It's here only for A/B comparison, not for production use.
 */
export function generateLegacySyntheticFlow(
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
): TerrainFlowResponse {
  const startTime = Date.now();
  
  console.log('[TerrainFlow] === LEGACY SYNTHETIC (comparison only) ===');
  
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
  // v1.5: Seed deterministic PRNG from parcel centroid
  seedRng(centroid);
  const widthM = distanceMeters([bbox[0], centroid[1]], [bbox[2], centroid[1]]);
  const heightM = distanceMeters([centroid[0], bbox[1]], [centroid[0], bbox[3]]);
  const parcelAcres = (widthM * heightM * 0.8) / 4046.86;
  
  // LEGACY: Determine dominant axis for flow direction (this is what we're removing)
  const isNorthSouth = heightM > widthM;
  const primaryBearing = isNorthSouth ? 0 : 90; // N-S or E-W - this is the WRONG approach
  
  // Generate axis-aligned primary flow lines (LEGACY - parcel shape based)
  const primaryLines: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  const numPrimary = Math.min(4, Math.max(2, Math.floor(parcelAcres / 30)));
  
  for (let i = 0; i < numPrimary; i++) {
    const offset = (i - (numPrimary - 1) / 2) * (isNorthSouth ? widthM : heightM) / (numPrimary + 1);
    const line = generateLegacyFlowLine(
      centroid,
      primaryBearing,
      Math.min(isNorthSouth ? heightM : widthM, 800) * 0.8,
      offset,
      isNorthSouth,
      'primary'
    );
    if (line) primaryLines.push(line);
  }
  
  // Generate axis-aligned secondary flow lines (LEGACY)
  const secondaryLines: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  const numSecondary = Math.min(6, Math.max(3, Math.floor(parcelAcres / 20)));
  
  for (let i = 0; i < numSecondary; i++) {
    const offset = (i - (numSecondary - 1) / 2) * (isNorthSouth ? widthM : heightM) / (numSecondary + 1);
    const angle = primaryBearing + (sRand() - 0.5) * 40;
    const line = generateLegacyFlowLine(
      centroid,
      angle,
      Math.min(isNorthSouth ? heightM : widthM, 500) * 0.6,
      offset,
      isNorthSouth,
      'secondary'
    );
    if (line) secondaryLines.push(line);
  }
  
  // LEGACY: Generate convergence zones via endpoint clustering (wrong approach)
  const convergenceZones: GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[] = [];
  const numConvergence = Math.min(3, Math.max(1, Math.floor(parcelAcres / 40)));
  
  for (let i = 0; i < numConvergence; i++) {
    const offsetLng = (sRand() - 0.5) * (bbox[2] - bbox[0]) * 0.6;
    const offsetLat = (sRand() - 0.5) * (bbox[3] - bbox[1]) * 0.6;
    const point: [number, number] = [centroid[0] + offsetLng, centroid[1] + offsetLat];
    
    convergenceZones.push({
      type: 'Feature',
      properties: {
        id: `conv_${i}`,
        intensity: 0.65 + sRand() * 0.25,
        flowCount: 2 + Math.floor(sRand() * 2),
        radiusM: 30 + sRand() * 40,
        type: i === 0 ? 'pinch' : 'overlap',
      },
      geometry: {
        type: 'Point',
        coordinates: point,
      },
    });
  }
  
  // Generate opportunity zones
  const opportunityZones: GeoJSON.Feature<GeoJSON.Point, OpportunityZoneProperties>[] = [];
  if (convergenceZones.length > 0 && parcelAcres >= 20) {
    const topConvergence = convergenceZones[0];
    opportunityZones.push({
      type: 'Feature',
      properties: {
        id: 'opp_1',
        score: 0.75 + sRand() * 0.15,
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
      dem_source: 'GEOMETRY_BASED (LEGACY)',
      resolution_m: 0,
      buffer_m: 0,
      weights: TERRAIN_FLOW_WEIGHTS,
      thresholds: {
        primary_min: FLOW_THRESHOLDS.primary_percentile,
        secondary_min: FLOW_THRESHOLDS.secondary_percentile,
        min_length_m_primary: FLOW_THRESHOLDS.min_length_m_primary,
        min_length_m_secondary: FLOW_THRESHOLDS.min_length_m_secondary,
        convergence_threshold: FLOW_THRESHOLDS.convergence_threshold,
        opportunity_threshold: FLOW_THRESHOLDS.opportunity_threshold,
      },
      stats: {
        flow_count_primary: primaryLines.length,
        flow_count_secondary: secondaryLines.length,
        convergence_count: convergenceZones.length,
        opportunity_count: opportunityZones.length,
        total_flow_length_m: 0,
        coverage_pct: 0,
      },
      fallback_reason: 'LEGACY SYNTHETIC - parcel-axis-based generation for comparison only',
    },
  };
}

/**
 * Generate a LEGACY flow line (axis-aligned, parcel-shape-based)
 */
function generateLegacyFlowLine(
  center: [number, number],
  bearing: number,
  length: number,
  offset: number,
  isNorthSouth: boolean,
  tier: FlowTier
): GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties> | null {
  const offsetBearing = bearing + 90;
  const offsetPoint = movePoint(center, offsetBearing, offset);
  
  const numPoints = 8;
  const coords: [number, number][] = [];
  
  for (let i = 0; i < numPoints; i++) {
    const t = (i / (numPoints - 1)) - 0.5;
    const dist = t * length;
    // Simple sinusoidal variation (less organic than terrain-driven)
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
      id: `flow_${tier}_${nextFlowId()}`,
      tier,
      likelihood: tier === 'primary' ? 0.80 + sRand() * 0.15 : 0.60 + sRand() * 0.15,
      lengthM: Math.round(lineLength),
      avgSlope: 8 + sRand() * 6,
      convergenceScore: 0.5 + sRand() * 0.3,
    },
    geometry: {
      type: 'LineString',
      coordinates: coords,
    },
  };
}

// ========== BACKWARDS COMPATIBILITY ==========

/**
 * Generate synthetic terrain flow - now redirects to terrain-driven
 * Kept for backwards compatibility with existing code
 */
export function generateSyntheticTerrainFlow(
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
): TerrainFlowResponse {
  // V2: Use terrain-driven generation by default
  return generateTerrainDrivenFlow(parcel, null, null);
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
      buffer_m: 0,
      weights: TERRAIN_FLOW_WEIGHTS,
      thresholds: {
        primary_min: FLOW_THRESHOLDS.primary_percentile,
        secondary_min: FLOW_THRESHOLDS.secondary_percentile,
        min_length_m_primary: FLOW_THRESHOLDS.min_length_m_primary,
        min_length_m_secondary: FLOW_THRESHOLDS.min_length_m_secondary,
        convergence_threshold: FLOW_THRESHOLDS.convergence_threshold,
        opportunity_threshold: FLOW_THRESHOLDS.opportunity_threshold,
      },
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
