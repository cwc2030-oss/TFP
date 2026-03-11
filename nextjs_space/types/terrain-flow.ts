/**
 * Terrain Flow Types
 * 
 * Types for terrain-guided movement likelihood surfaces,
 * flow lines, convergence zones, and opportunity areas.
 */

export type FlowTier = 'primary' | 'secondary';
export type ConvergenceType = 'pinch' | 'overlap' | 'saddle';
export type FlowMode = 'real_dem' | 'synthetic' | 'error';

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
  debug_layers?: {
    bench_likelihood?: GeoJSON.FeatureCollection;
    saddle_influence?: GeoJSON.FeatureCollection;
    spine_influence?: GeoJSON.FeatureCollection;
    convergence_surface?: GeoJSON.FeatureCollection;
    slope_preference?: GeoJSON.FeatureCollection;
  };
  
  metadata: TerrainFlowMetadata;
}

export interface TerrainFlowMetadata {
  processing_time_seconds: number;
  mode: FlowMode;
  dem_source: string;
  resolution_m: number;
  weights: {
    bench_likelihood: number;
    saddle_proximity: number;
    spine_proximity: number;
    terrain_convergence: number;
    moderate_slope: number;
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
