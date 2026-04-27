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

// ============ v1 Response Types (Intelligence Engine envelope) ============

export interface Top3Stand {
  rank: number;
  score: number;
  label: string;
  reasoning: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
}

export interface TerrainSummaryV1 {
  bedding:   { count: number; totalAcres: number };
  funnels:   { count: number };
  corridors: { count: number; primary: number; secondary: number };
  narrative: string;
}

export interface TerrainLayersV1 {
  beddingPolygons: GeoJSON.FeatureCollection;
  funnels:         GeoJSON.FeatureCollection;
  standPoints:     GeoJSON.FeatureCollection;
  corridors:       GeoJSON.FeatureCollection;
}

export interface TodaysSit {
  standRank?: number;
  score?:     number;
  label?:     string;
  reasoning?: string;
  geometry?:  { type: 'Point'; coordinates: [number, number] };
  isStub:     boolean;
  note:       string;
}

export interface TerrainMeta {
  apiVersion:        string;
  analysisAreaAcres: number;
  recommendedSeason: string;
  generatedAt:       string;
  requestId:         string;
  mode:              string;
}

/** v1 Intelligence Engine response envelope */
export interface TerrainAnalysisResponse {
  huntabilityScore: number;
  top3Stands:       Top3Stand[];
  terrainSummary:   TerrainSummaryV1;
  layers:           TerrainLayersV1;
  todaysSit:        TodaysSit;
  meta:             TerrainMeta;
}

// ============ Legacy Internal Types (used by scoring, overlays, UI state) ============

/**
 * Internal layers shape — typed feature collections.
 * Consumers that need typed features should use this.
 */
export interface TerrainLayers {
  beddingPolygons: GeoJSON.FeatureCollection<GeoJSON.Polygon, BeddingProperties>;
  funnels: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties>;
  standPoints: GeoJSON.FeatureCollection<GeoJSON.Point, StandPointProperties>;
  corridors?: GeoJSON.FeatureCollection;
}

/**
 * Legacy summary shape — used by scoring engine and overlay components.
 * Populated by adaptV1Response() from the v1 terrainSummary.
 */
export interface TerrainSummary {
  totalBeddingAcres: number;
  funnelCount: number;
  topStandScore: number;
  analysisAreaAcres: number;
  recommendedSeason: SeasonProfile;
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

/**
 * Legacy provenance shape — used by overlay and intel panels.
 * Populated by adaptV1Response() from the v1 meta.
 */
export interface TerrainProvenance {
  demSource: string;
  demResolution: string;
  demAcquisitionDate?: string;
  landcoverSource: string;
  analysisTimestamp: string;
  processingTimeSeconds?: number;
  isPreview: boolean;
  mode?: string;
}

// ============ v1 → Legacy Adapter ============

export interface AdaptedTerrainResponse {
  mode: TerrainMode;
  layers: TerrainLayers;
  summary: TerrainSummary;
  provenance: TerrainProvenance;
  /** Pass-through of the raw v1 envelope for components that need it */
  v1: TerrainAnalysisResponse;
}

/**
 * Convert a v1 Intelligence Engine response to the legacy internal shape
 * used by scoring, overlays, and UI state components.
 */
export function adaptV1Response(v1: TerrainAnalysisResponse): AdaptedTerrainResponse {
  const topStandScore = v1.top3Stands?.[0]?.score ?? 0;

  const layers: TerrainLayers = {
    beddingPolygons: v1.layers.beddingPolygons as TerrainLayers['beddingPolygons'],
    funnels: v1.layers.funnels as TerrainLayers['funnels'],
    standPoints: v1.layers.standPoints as TerrainLayers['standPoints'],
    corridors: v1.layers.corridors,
  };

  const summary: TerrainSummary = {
    totalBeddingAcres: v1.terrainSummary.bedding.totalAcres,
    funnelCount: v1.terrainSummary.funnels.count,
    topStandScore,
    analysisAreaAcres: v1.meta.analysisAreaAcres,
    recommendedSeason: (v1.meta.recommendedSeason as SeasonProfile) || 'rut',
    // demMetrics not in v1 envelope — left undefined, scoring stubs handle it
  };

  const provenance: TerrainProvenance = {
    demSource: 'USGS_3DEP',
    demResolution: '~10m',
    landcoverSource: 'ESTIMATED',
    analysisTimestamp: v1.meta.generatedAt,
    isPreview: false,
    mode: v1.meta.mode,
  };

  return {
    mode: (v1.meta.mode as TerrainMode) || 'real',
    layers,
    summary,
    provenance,
    v1,
  };
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
  standResilience?: number;       // 0-1, pressure-based resilience score
  // Edge stand classification (v2.1 — field-edge hunting behaviour)
  coverType?: 'timber' | 'edge' | 'open' | 'draw';
  isEdgeStand?: boolean;          // true if stand is on a field/timber boundary
  fieldBearing?: number;          // bearing (0-360) toward the open field side
  edgeConfidence?: number;        // 0-1, strength of edge detection signal
}

// ============ Ridge Spine Types (Structure-First, DEM-Only) ============

export type RidgeTier = 'primary' | 'secondary';

export interface RidgeSpineProperties {
  tier: RidgeTier;                  // Primary (major spines) or Secondary (shorter ridges)
  prominenceFt: number;             // Drop on both sides in feet (>20 ft required)
  lengthMeters: number;             // Continuous length in meters (>200m for primary)
  avgElevationM: number;            // Average elevation along ridge
  avgSlopeDeg: number;              // Average slope of ridge flanks
  curvatureProfile: number;         // Profile curvature (convexity measure)
  id: string;                       // Unique ridge identifier
}

export interface SaddleNodeProperties {
  id: string;                       // Unique saddle identifier
  elevationM: number;               // Elevation at saddle point
  ridgeDropFt: number;              // Prominence drop from adjacent ridge peaks
  adjacentRidgeIds: string[];       // IDs of ridges this saddle connects
}

export interface RidgeSpineResponse {
  success: boolean;
  bbox: [number, number, number, number];
  
  // Primary ridges: major continuous spines (>200m, >20ft prominence)
  ridges_primary: GeoJSON.FeatureCollection<GeoJSON.LineString, RidgeSpineProperties>;
  
  // Secondary ridges: shorter but valid ridges (>100m, >15ft prominence)
  ridges_secondary: GeoJSON.FeatureCollection<GeoJSON.LineString, RidgeSpineProperties>;
  
  // Saddle nodes: low points between ridge peaks
  saddle_nodes: GeoJSON.FeatureCollection<GeoJSON.Point, SaddleNodeProperties>;
  
  metadata: RidgeSpineMetadata;
}

export interface RidgeSpineMetadata {
  processing_time_seconds: number;
  dem_source: string;
  resolution_m: number;
  thresholds: {
    min_prominence_ft_primary: number;
    min_prominence_ft_secondary: number;
    min_length_m_primary: number;
    min_length_m_secondary: number;
  };
  total_ridge_length_m: number;
  ridge_count_primary: number;
  ridge_count_secondary: number;
  saddle_count: number;
  backbone_confidence?: number;  // 0-1 confidence score for backbone detection
  fallback_reason?: string | null;
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
  /** Raw v1 envelope when available */
  v1?: TerrainAnalysisResponse | null;
}

// ============ Layer Visibility ============

export interface TerrainLayerVisibility {
  bedding: boolean;
  funnels: boolean;      // Legacy combined key (kept for compat)
  saddles: boolean;      // Independent saddle visibility
  draws: boolean;        // Independent draw visibility
  stands: boolean;
  corridors: boolean;
  ridgeSpines: boolean;  // Structure-first terrain anatomy layer
}
