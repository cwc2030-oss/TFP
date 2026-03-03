// Terra Firma Terrain Brain Types
// GeoJSON interfaces for hunting intelligence layers

export type SeasonProfile = 'early' | 'rut' | 'late';
export type WindDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export type FunnelType = 'saddle' | 'draw' | 'corridor';
export type FunnelStrength = 'hard' | 'slight';  // Compression zone strength
export type CorridorTier = 'primary' | 'possible' | 'exploratory';  // Movement tiers
export type ApproachRisk = 'low' | 'medium' | 'high';
export type TerrainMode = 'real' | 'preview';

// ============ Request Types ============

export interface TerrainAnalysisRequest {
  parcel: GeoJSON.Feature<GeoJSON.Polygon>;
  bufferMeters?: number;        // default: 800
  seasonProfile?: SeasonProfile; // default: 'rut'
  prevailingWinds?: WindDirection[];
  options?: TerrainAnalysisOptions;
}

export interface TerrainAnalysisOptions {
  includeBedding?: boolean;
  includeFunnels?: boolean;
  includeStandPoints?: boolean;
  tpiScales?: number[];  // default: [100, 500]
}

// ============ Response Types ============

export interface TerrainAnalysisResponse {
  mode: TerrainMode;
  layers: TerrainLayers;
  summary: TerrainSummary;
  provenance: TerrainProvenance;
}

export interface TerrainLayers {
  beddingPolygons: GeoJSON.FeatureCollection<GeoJSON.Polygon, BeddingProperties>;
  funnels: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties>;
  standPoints: GeoJSON.FeatureCollection<GeoJSON.Point, StandPointProperties>;
}

export interface TerrainSummary {
  totalBeddingAcres: number;
  funnelCount: number;
  topStandScore: number;
  analysisAreaAcres: number;
  recommendedSeason: SeasonProfile;
  
  // === DEM-derived metrics (optional, from geoprocessor v3+) ===
  demMetrics?: DEMMetrics;
}

/**
 * DEM-derived terrain statistics
 * Used for terrain_diversity scoring
 */
export interface DEMMetrics {
  /** Elevation range: p95 - p5 (meters) */
  elevRange: number;
  /** Standard deviation of slope (degrees) */
  slopeStd: number;
  /** TPI contrast: std of TPI at 500m scale */
  tpiContrast: number;
  /** Roughness: p90 slope - p10 slope (degrees) */
  roughness: number;
  /** Min elevation (meters) */
  elevMin?: number;
  /** Max elevation (meters) */
  elevMax?: number;
  /** Mean slope (degrees) */
  slopeMean?: number;
}

export interface TerrainProvenance {
  demSource: string;           // e.g., 'USGS_3DEP_1m' or 'MAPBOX_TERRAIN_RGB'
  demResolution: string;       // e.g., '1m' or '~30m'
  demAcquisitionDate?: string; // ISO date or null for preview
  landcoverSource: string;     // e.g., 'NLCD_2021' or 'ESTIMATED'
  analysisTimestamp: string;   // ISO timestamp
  processingTimeSeconds?: number;
  isPreview: boolean;
}

// ============ Feature Properties ============

export interface BeddingProperties {
  type: 'thermal_bedding' | 'transition_bedding' | 'escape_cover';
  slopeRange: [number, number];  // e.g., [8, 25]
  aspect: string;                // e.g., 'S', 'SW'
  aspectDegrees: number;         // 135-225 for south-facing
  areaAcres: number;
  confidence: number;            // 0-1
}

export interface FunnelProperties {
  funnelType: FunnelType;
  narrowestWidthMeters?: number;  // for saddles
  corridorScore: number;          // 0-1
  leastCostPath?: boolean;        // for corridors
  connectsBeddingToFood?: boolean;
  flowAccumulation?: number;      // for draws
  
  // === Enhanced tiering fields (v2+) ===
  tier?: CorridorTier;            // Primary/Possible/Exploratory
  strength?: FunnelStrength;      // Hard/Slight (for compression zones)
  intrusion?: number;             // 0-1 approach intrusion score
  isOnParcel?: boolean;           // true = on parcel, false = context (off-parcel)
  localBaseline?: number;         // Local baseline score for relative tiering
}

// ============ Tiered Corridor Response (v2+) ============

export interface TieredCorridorResponse {
  success: boolean;
  bbox: [number, number, number, number];
  
  // Primary corridors: top band (≥0.70 OR top 10-15%)
  corridors_primary: GeoJSON.FeatureCollection<GeoJSON.LineString, FunnelProperties>;
  
  // Possible corridors: ≥1.5× baseline OR top 15-35%
  corridors_possible: GeoJSON.FeatureCollection<GeoJSON.LineString, FunnelProperties>;
  
  // Exploratory lanes: ≥1.2× baseline OR top 35-55% (faint)
  corridors_exploratory: GeoJSON.FeatureCollection<GeoJSON.LineString, FunnelProperties>;
  
  // Hard funnels: Strong compression nodes (saddles, pinch points)
  funnels_hard: GeoJSON.FeatureCollection<GeoJSON.Polygon, FunnelProperties>;
  
  // Slight funnels: Moderate compression (valley benches, ridge lines)
  funnels_slight: GeoJSON.FeatureCollection<GeoJSON.Polygon, FunnelProperties>;
  
  // Off-parcel context corridors (reduced opacity, no interaction)
  corridors_context_primary: GeoJSON.FeatureCollection<GeoJSON.LineString, FunnelProperties>;
  corridors_context_possible: GeoJSON.FeatureCollection<GeoJSON.LineString, FunnelProperties>;
  
  metadata: CorridorMetadata;
}

export interface CorridorMetadata {
  processing_time_seconds: number;
  dem_source: string;
  resolution_m: number;
  weights: {
    slope_preference: string;
    concavity_weight: number;
  };
  tiering: {
    local_baseline: number;       // Local movement baseline for parcel
    primary_threshold: number;    // Threshold for primary tier
    possible_threshold: number;   // Threshold for possible tier
    exploratory_threshold: number; // Threshold for exploratory tier
    parcel_coverage_pct: number;  // % of parcel covered by corridors
  };
  fallback_reason?: string | null;
}

export interface StandPointProperties {
  rank: number;
  score: number;                  // 0-100
  name?: string;                  // user-assigned or auto-suggested name
  windOk: WindDirection[];        // good wind directions
  windBad: WindDirection[];       // bad wind directions
  approachRisk: ApproachRisk;
  distToCorridorMeters: number;
  distToBeddingMeters: number;
  elevation: number;              // meters
  tpiLocal: number;               // TPI at 100m scale
  tpiLandscape: number;           // TPI at 500m scale
  reasoning: string;              // human-readable explanation
}

// ============ Error Types ============

export interface TerrainAnalysisError {
  code: 'AOI_TOO_LARGE' | 'INVALID_GEOMETRY' | 'DEM_UNAVAILABLE' | 'PROCESSING_TIMEOUT' | 'SERVICE_UNAVAILABLE' | 'INTERNAL_ERROR';
  message: string;
  fallbackToPreview?: boolean;
}

// ============ UI State Types ============

export interface TerrainIntelState {
  mode: TerrainMode;
  isLoading: boolean;
  progress: number;         // 0-100
  error: TerrainAnalysisError | null;
  layers: TerrainLayers | null;
  summary: TerrainSummary | null;
  provenance: TerrainProvenance | null;
  selectedStand: number | null;  // rank of selected stand
}

// ============ Layer Visibility ============

export interface TerrainLayerVisibility {
  bedding: boolean;
  funnels: boolean;
  stands: boolean;
  corridors: boolean;
}
