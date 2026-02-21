/**
 * Component Input Types
 * Defines the data contract each scoring component expects
 */

import type { TerrainLayers, TerrainSummary, StandPointProperties, BeddingProperties, FunnelProperties } from '@/types/terrain';

/**
 * Input for all scoring components
 * Contains terrain analysis results plus optional hydro data
 */
export interface ComponentInput {
  /** Terrain analysis layers from geoprocessor */
  layers: TerrainLayers;
  /** Terrain summary statistics */
  summary: TerrainSummary;
  /** Total parcel acreage */
  parcelAcres: number;
  /** Parcel centroid [lng, lat] */
  centroid: [number, number];
  /** Optional: Real hydro features if available */
  hydroFeatures?: HydroFeatures;
}

/**
 * Hydro features from external data source (NHD, etc.)
 * Optional - water_proximity can estimate from terrain if not available
 */
export interface HydroFeatures {
  /** Water body polygons (ponds, lakes) */
  waterBodies: GeoJSON.FeatureCollection<GeoJSON.Polygon>;
  /** Stream/creek lines */
  streams: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  /** Springs/seeps points */
  springs: GeoJSON.FeatureCollection<GeoJSON.Point>;
}

/** Data source status for component calculations */
export type ComponentStatus = 'real' | 'estimated' | 'stubbed';

/**
 * Component output before weighting
 * Includes full provenance for explainability and licensing
 */
export interface ComponentResult {
  componentId: string;
  raw: number;
  normalized: number; // 0-1 (may be capped for estimated data)
  unit: string;
  notes: string;
  
  // === Provenance fields for explainability ===
  /** Data source status */
  status: ComponentStatus;
  /** Confidence in this component's accuracy (0-1) */
  confidence: number;
  /** List of input data sources used */
  inputsUsed: string[];
  
  /** Additional metadata for debugging */
  metadata?: Record<string, unknown>;
}

/**
 * Bedding polygon with computed metrics
 */
export interface BeddingMetrics {
  totalAcres: number;
  polygonCount: number;
  avgConfidence: number;
  thermalBeddingAcres: number;
  transitionBeddingAcres: number;
  escapeCoverAcres: number;
  avgSlopeDegrees: number;
  dominantAspect: string;
}

/**
 * Stand site with distance metrics
 */
export interface StandMetrics {
  rank: number;
  score: number;
  distToBeddingMeters: number;
  distToCorridorMeters: number;
  distToWaterMeters?: number;
}
