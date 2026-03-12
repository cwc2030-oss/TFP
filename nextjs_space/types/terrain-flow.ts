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
}

// ========== UI State Types ==========

export interface TerrainFlowState {
  isLoading: boolean;
  error: string | null;
  data: TerrainFlowResponse | null;
  isSynthetic: boolean;
}

export interface TerrainFlowVisibility {
  flowPrimary: boolean;
  flowSecondary: boolean;
  convergenceZones: boolean;
  opportunityZones: boolean;
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
