/**
 * Terrain Flow Types
 * 
 * Types for terrain-guided movement likelihood surfaces,
 * flow lines, convergence zones, and opportunity areas.
 * 
 * V2: Added debug layers and mode tracking for terrain-driven analysis
 * V2.1: Added flow segment scoring for click-to-explain functionality
 */

export type FlowTier = 'primary' | 'secondary';
export type ConvergenceType = 'pinch' | 'overlap' | 'saddle';
export type FlowMode = 'real_dem' | 'terrain_driven' | 'synthetic' | 'error';
export type TerrainFeatureType = 'ridge' | 'saddle' | 'bench' | 'drainage';

// ========== Feature Properties ==========

export interface FlowLineProperties {
  id: string;                    // Unique flow line identifier
  tier: FlowTier;                // Primary or Secondary flow
  likelihood: number;            // 0-1 movement likelihood score
  lengthM: number;               // Length in meters
  avgSlope: number;              // Average slope along line (degrees)
  convergenceScore: number;      // 0-1 how much it converges with others
}

export interface ConvergenceZoneProperties {
  id: string;                    // Unique zone identifier
  intensity: number;             // 0-1 convergence intensity
  flowCount: number;             // Number of flows converging
  radiusM: number;               // Effective radius in meters
  type: ConvergenceType;         // Type of convergence
}

export interface OpportunityZoneProperties {
  id: string;                    // Unique zone identifier
  score: number;                 // 0-1 opportunity score
  flowIntensity: number;         // Flow component
  convergenceBonus: number;      // Convergence bonus
  benchBonus: number;            // Bench terrain bonus
  saddleBonus: number;           // Saddle proximity bonus
  radiusM: number;               // Display radius
}

// ========== Debug Layer Types ==========

export interface DebugGridPoint {
  value: number;
  layer: string;
}

export interface DebugLayers {
  slope_preference?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  bench_likelihood?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  saddle_proximity?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  spine_proximity?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  terrain_convergence?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  extreme_slope_penalty?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  cut_penalty?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  flow_likelihood?: GeoJSON.FeatureCollection<GeoJSON.Point>;
}

// ========== Response Types ==========

export interface TerrainFlowResponse {
  success: boolean;
  bbox: [number, number, number, number];
  
  // Primary flow: high-likelihood terrain-guided movement
  flow_primary: GeoJSON.FeatureCollection<GeoJSON.LineString, FlowLineProperties>;
  
  // Secondary flow: moderate-likelihood supporting flows
  flow_secondary: GeoJSON.FeatureCollection<GeoJSON.LineString, FlowLineProperties>;
  
  // Convergence zones: where flows overlap or pinch
  convergence_zones: GeoJSON.FeatureCollection<GeoJSON.Point, ConvergenceZoneProperties>;
  
  // Opportunity zones: high-value strategic locations
  opportunity_zones: GeoJSON.FeatureCollection<GeoJSON.Point, OpportunityZoneProperties>;
  
  // Debug layers (optional, for dev tuning)
  debug_layers?: DebugLayers;
  
  metadata: TerrainFlowMetadata;
}

export interface TerrainFlowMetadata {
  processing_time_seconds: number;
  mode: FlowMode;
  dem_source: string;
  resolution_m: number;
  buffer_m: number;              // Analysis buffer size
  weights: {
    bench_likelihood: number;
    saddle_proximity: number;
    spine_proximity: number;
    terrain_convergence: number;
    moderate_slope: number;
    extreme_slope_penalty?: number;
    cut_penalty?: number;
  };
  thresholds: {
    primary_min: number;
    secondary_min: number;
    min_length_m_primary: number;
    min_length_m_secondary: number;
    convergence_threshold: number;
    opportunity_threshold: number;
  };
  stats: {
    flow_count_primary: number;
    flow_count_secondary: number;
    convergence_count: number;
    opportunity_count: number;
    total_flow_length_m: number;
    coverage_pct: number;
  };
  fallback_reason?: string | null;
  analysis_extent?: {
    parcel_bbox: [number, number, number, number];
    buffered_bbox: [number, number, number, number];
  };
  // Parcel-adaptive scaling metrics
  parcel_scale?: {
    diagonal_m: number;         // Parcel diagonal in meters
    scale_factor: number;       // Scale factor (1.0 = reference 40-acre)
    acres: number;              // Approximate acreage
  };
  // V3: Pattern classification for flow generation
  pattern?: {
    type: string;               // linear, funnel, bench, crossroads, sparse, none
    confidence: number;         // 0-1 confidence in classification
    structure_score: number;    // 0-1 how much terrain structure detected
    dominant_bearing: number;   // Primary flow direction in degrees
    explanation: string;        // Human-readable explanation
  };
  // Shared "is there a real terrain backbone?" verdict. Computed ONCE by the
  // flow engine from the traced ridge network (lib/terrain-backbone.ts) and
  // consulted by BOTH the flow rendering and the terrain story so the two can
  // never contradict (honest-empty flow <-> low-relief story).
  backbone?: BackboneVerdict;
}

// Shared backbone determination shape (see lib/terrain-backbone.ts).
export interface BackboneVerdict {
  hasRealBackbone: boolean;
  // Count of PROMINENCE-QUALIFIED traced ridge lines (each >= NETWORK_LINE_MIN_FT),
  // NOT the raw traced-line count. Weak sub-floor artifact spines are excluded so
  // a flat parcel can't clear the multi-line side of the gate on count alone.
  networkLines: number;
  maxProminenceFt: number;
  reason: string;
  // READ-ONLY DIAGNOSTIC (v6.4.2). Prominences (ft, rounded, desc) of every
  // parcel-relevant traced ridge line considered by the gate — primary+secondary,
  // AFTER the relevance filter, BEFORE the per-line 40ft qualification. This is
  // the exact set whose max is maxProminenceFt and whose >=NETWORK_LINE_MIN_FT
  // count is networkLines. Surfaced so an emptied move's real spine prominences
  // are visible from server logs / batch scans without Clark's browser console.
  // Optional: absent on the retired legacy template path.
  linePromsFt?: number[];
  // READ-ONLY DIAGNOSTIC (length/continuity calibration). Per-line spine length (m)
  // and ridge-service coherence score (avgRidgeScore), aligned index-for-index with
  // linePromsFt so a spine's prominence/length/coherence line up. Optional: absent
  // on the retired legacy template path and the pre-relevance early returns.
  lineLensM?: number[];
  lineCoherence?: number[];
  /** Read-only flank-relief diagnostic (ft): median bilateral DEM drop sampled perpendicular to each ridge spine at ~125m on both flanks over up to 9 stations. A genuine ridge drops on BOTH sides; a bench/road-berm/flat-ag artifact stays flat. Per relevant line, same order as lineLensM/lineCoherence. */
  lineFlankFt?: number[];
}

// ========== UI State Types ==========

export interface TerrainFlowState {
  isLoading: boolean;
  error: string | null;
  data: TerrainFlowResponse | null;
  isSynthetic: boolean;
}

export interface TerrainFlowVisibility {
  pressureHeatmap: boolean;   // PRIMARY: Terrain pressure heat map
  flowGreen: boolean;         // Green tier: high-confidence flow (≥0.66)
  flowBlue: boolean;          // Blue tier: moderate-confidence flow (0.33–0.66)
  flowBlack: boolean;         // Black tier: low-confidence flow (<0.33)
  convergenceZones: boolean;  // Convergence zone markers (convergence IS opportunity)
  // Legacy aliases (backward compat — resolve to green/blue)
  flowPrimary?: boolean;
  flowSecondary?: boolean;
}

// ========== Comparison Mode ==========

export interface FlowComparisonState {
  showSynthetic: boolean;        // Show old synthetic flow
  showTerrainDriven: boolean;    // Show new terrain-driven flow
  syntheticData: TerrainFlowResponse | null;
  terrainDrivenData: TerrainFlowResponse | null;
}

// ========== Flow Segment Scoring (Click-to-Explain) ==========

export interface FlowSegmentComponentScores {
  slope_preference: number;      // 0-1 slope favorability
  bench_likelihood: number;      // 0-1 bench detection
  saddle_proximity: number;      // 0-1 proximity to saddles
  spine_proximity: number;       // 0-1 proximity to ridges
  terrain_convergence: number;   // 0-1 flow convergence
  extreme_slope_penalty: number; // 0-1 steep slope penalty
  cut_penalty: number;           // 0-1 drainage penalty
  total_likelihood: number;      // Combined weighted score
}

export interface FlowSegmentPointScore {
  coord: [number, number];       // Geographic coordinate
  slope_deg: number;             // Raw slope in degrees
  profile_curv: number;          // Profile curvature (-1 to 1)
  plan_curv: number;             // Plan curvature (-1 to 1)
  bench: number;                 // Bench score
  saddle: number;                // Saddle proximity
  spine: number;                 // Ridge/spine proximity
  convergence: number;           // Convergence score
  penalty: number;               // Combined penalties
  likelihood: number;            // Final likelihood
}

export interface FlowSegmentScoreResponse {
  segmentId: string;
  coordinates: [number, number][];
  scores: FlowSegmentComponentScores;
  pointScores: FlowSegmentPointScore[];
  explanation: string;           // Human-readable explanation
}

// ========== Enhanced Debug Layers ==========

export interface EnhancedDebugLayers extends DebugLayers {
  // Raw DEM-derived surfaces
  slope_deg?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  aspect_deg?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  profile_curvature?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  plan_curvature?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  // Feature detection
  ridge_likelihood?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  saddle_likelihood?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  drainage_likelihood?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  // Detected feature points
  ridge_points?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  saddle_points?: GeoJSON.FeatureCollection<GeoJSON.Point>;
}

// ========== Terrain Feature Points ==========

export interface TerrainFeaturePointProperties {
  type: TerrainFeatureType;
  confidence: number;            // 0-1 detection confidence
  elevation_m?: number;          // Elevation at point
  slope_deg?: number;            // Slope at point
  curvature?: number;            // Relevant curvature value
}

// ========== Extended Response with DEM Analysis ==========

export interface TerrainFlowResponseV2 extends TerrainFlowResponse {
  // DEM analysis metadata
  dem_analysis?: {
    source: string;
    resolution_m: number;
    coverage_pct: number;
    features_detected: {
      ridges: number;
      saddles: number;
      benches: number;
      drainages: number;
    };
  };
  // Enhanced debug layers
  debug_layers?: EnhancedDebugLayers;
  // Detected terrain features as GeoJSON
  terrain_features?: {
    ridges?: GeoJSON.FeatureCollection<GeoJSON.Point, TerrainFeaturePointProperties>;
    saddles?: GeoJSON.FeatureCollection<GeoJSON.Point, TerrainFeaturePointProperties>;
  };
}
