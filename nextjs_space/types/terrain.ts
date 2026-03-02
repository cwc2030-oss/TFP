// Terra Firma Terrain Brain Types
// GeoJSON interfaces for hunting intelligence layers

export type SeasonProfile = 'early' | 'rut' | 'late';
export type WindDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export type FunnelType = 'saddle' | 'draw' | 'corridor';
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
