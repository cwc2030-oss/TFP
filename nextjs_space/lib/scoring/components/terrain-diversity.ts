/**
 * Terrain Diversity Component
 * 
 * Calculates terrain diversity from DEM-derived metrics.
 * Uses real DEM data when available, estimates from terrain features otherwise.
 * 
 * Metrics (normalized ranges):
 * - elev_range (p95-p5): 0-60m for full score
 * - slope_std: 0-8° for full score
 * - tpi_contrast (std of TPI_500): 0-1.2 for full score
 * - roughness (p90-p10 slope): 0-18° for full score
 * 
 * Weights: 0.30/0.25/0.25/0.20
 */

import type { ComponentInput, ComponentResult, ComponentStatus } from './types';
import type { DEMMetrics, BeddingProperties, FunnelProperties, StandPointProperties } from '@/types/terrain';

// === Normalization Ranges (max values for 100% score) ===
const NORM_ELEV_RANGE = 60;      // 60m elevation range = max score
const NORM_SLOPE_STD = 8;        // 8° slope std = max score
const NORM_TPI_CONTRAST = 1.2;   // 1.2 TPI std = max score
const NORM_ROUGHNESS = 18;       // 18° roughness = max score

// === Component Weights ===
const WEIGHT_ELEV_RANGE = 0.30;
const WEIGHT_SLOPE_STD = 0.25;
const WEIGHT_TPI_CONTRAST = 0.25;
const WEIGHT_ROUGHNESS = 0.20;

// === Confidence Levels ===
const CONFIDENCE_REAL = 0.95;
const CONFIDENCE_ESTIMATED = 0.50;

// Cap for estimated data
const ESTIMATED_NORMALIZED_CAP = 0.75;

/**
 * Sub-metric result for metadata
 */
interface SubMetric {
  name: string;
  raw: number;
  normalized: number;
  weight: number;
  contribution: number;
  unit: string;
}

/**
 * Calculate terrain diversity score from DEM metrics or estimates
 */
export function calculateTerrainDiversity(input: ComponentInput): ComponentResult {
  const { summary, layers, parcelAcres } = input;
  
  let demMetrics: DEMMetrics | null = null;
  let status: ComponentStatus;
  let confidence: number;
  let inputsUsed: string[];
  let notes: string;
  
  // Check if real DEM metrics are available
  if (summary.demMetrics && isValidDEMMetrics(summary.demMetrics)) {
    demMetrics = summary.demMetrics;
    status = 'real';
    confidence = CONFIDENCE_REAL;
    inputsUsed = ['dem_elevation', 'dem_slope', 'dem_tpi_500'];
    notes = 'Real DEM analysis';
  } else {
    // Estimate from available terrain features
    demMetrics = estimateDEMMetrics(input);
    status = 'estimated';
    confidence = CONFIDENCE_ESTIMATED;
    inputsUsed = ['terrain_funnels', 'bedding_polygons', 'stand_points', 'parcel_acreage'];
    notes = 'Estimated from terrain features';
  }
  
  // Calculate sub-metrics
  const subMetrics = calculateSubMetrics(demMetrics);
  
  // Combine into total score (0-1)
  let totalNormalized = subMetrics.reduce((sum, m) => sum + m.contribution, 0);
  
  // Cap estimated data
  if (status === 'estimated' && totalNormalized > ESTIMATED_NORMALIZED_CAP) {
    totalNormalized = ESTIMATED_NORMALIZED_CAP;
    notes += ` [capped at ${Math.round(ESTIMATED_NORMALIZED_CAP * 100)}%]`;
  }
  
  // Convert to 0-100 scale for raw display
  const rawScore = Math.round(totalNormalized * 100);
  
  // Generate quality note
  const qualityLabel = getQualityLabel(totalNormalized);
  const subMetricSummary = subMetrics
    .map(m => `${m.name}: ${m.raw.toFixed(1)}${m.unit} (${Math.round(m.normalized * 100)}%)`)
    .join(', ');
  const fullNotes = `${qualityLabel}. ${notes}. [${subMetricSummary}]`;
  
  return {
    componentId: 'terrain_diversity',
    raw: rawScore,
    normalized: Math.round(totalNormalized * 10000) / 10000,
    unit: 'score',
    notes: fullNotes,
    status,
    confidence,
    inputsUsed,
    metadata: {
      demMetrics,
      subMetrics: subMetrics.map(m => ({
        name: m.name,
        raw: m.raw,
        normalized: m.normalized,
        weight: m.weight,
        contribution: m.contribution,
        unit: m.unit
      })),
      weights: {
        elevRange: WEIGHT_ELEV_RANGE,
        slopeStd: WEIGHT_SLOPE_STD,
        tpiContrast: WEIGHT_TPI_CONTRAST,
        roughness: WEIGHT_ROUGHNESS
      },
      normalizationRanges: {
        elevRange: NORM_ELEV_RANGE,
        slopeStd: NORM_SLOPE_STD,
        tpiContrast: NORM_TPI_CONTRAST,
        roughness: NORM_ROUGHNESS
      }
    }
  };
}

/**
 * Validate that DEM metrics are present and reasonable
 */
function isValidDEMMetrics(metrics: DEMMetrics): boolean {
  return (
    typeof metrics.elevRange === 'number' && metrics.elevRange >= 0 &&
    typeof metrics.slopeStd === 'number' && metrics.slopeStd >= 0 &&
    typeof metrics.tpiContrast === 'number' && metrics.tpiContrast >= 0 &&
    typeof metrics.roughness === 'number' && metrics.roughness >= 0
  );
}

/**
 * Calculate normalized sub-metrics with contributions
 */
function calculateSubMetrics(dem: DEMMetrics): SubMetric[] {
  const metrics: SubMetric[] = [];
  
  // Elevation range
  const elevNorm = Math.min(1, dem.elevRange / NORM_ELEV_RANGE);
  metrics.push({
    name: 'Elev Range',
    raw: dem.elevRange,
    normalized: elevNorm,
    weight: WEIGHT_ELEV_RANGE,
    contribution: elevNorm * WEIGHT_ELEV_RANGE,
    unit: 'm'
  });
  
  // Slope std
  const slopeNorm = Math.min(1, dem.slopeStd / NORM_SLOPE_STD);
  metrics.push({
    name: 'Slope Std',
    raw: dem.slopeStd,
    normalized: slopeNorm,
    weight: WEIGHT_SLOPE_STD,
    contribution: slopeNorm * WEIGHT_SLOPE_STD,
    unit: '°'
  });
  
  // TPI contrast
  const tpiNorm = Math.min(1, dem.tpiContrast / NORM_TPI_CONTRAST);
  metrics.push({
    name: 'TPI Contrast',
    raw: dem.tpiContrast,
    normalized: tpiNorm,
    weight: WEIGHT_TPI_CONTRAST,
    contribution: tpiNorm * WEIGHT_TPI_CONTRAST,
    unit: ''
  });
  
  // Roughness
  const roughNorm = Math.min(1, dem.roughness / NORM_ROUGHNESS);
  metrics.push({
    name: 'Roughness',
    raw: dem.roughness,
    normalized: roughNorm,
    weight: WEIGHT_ROUGHNESS,
    contribution: roughNorm * WEIGHT_ROUGHNESS,
    unit: '°'
  });
  
  return metrics;
}

/**
 * Estimate DEM metrics from available terrain features when real DEM data unavailable
 */
function estimateDEMMetrics(input: ComponentInput): DEMMetrics {
  const { layers, summary, parcelAcres } = input;
  
  // Extract feature data
  const stands = layers.standPoints.features;
  const funnels = layers.funnels.features;
  const bedding = layers.beddingPolygons.features;
  
  // === Estimate elevation range ===
  // Use stand point elevations if available
  let elevRange = 15; // Base estimate
  if (stands.length >= 2) {
    const elevations = stands.map(s => (s.properties as StandPointProperties).elevation || 0);
    const validElevations = elevations.filter(e => e > 0);
    if (validElevations.length >= 2) {
      const minElev = Math.min(...validElevations);
      const maxElev = Math.max(...validElevations);
      elevRange = maxElev - minElev;
      // Scale up for p95-p5 estimate (actual range ~80% of p95-p5)
      elevRange = elevRange * 1.25;
    }
  }
  // Adjust by parcel size (larger parcels tend to have more elevation change)
  if (elevRange < 10) {
    elevRange = Math.min(30, 10 + (parcelAcres / 40) * 5);
  }
  // Funnels indicate elevation variation
  const saddles = funnels.filter(f => (f.properties as FunnelProperties).funnelType === 'saddle');
  const draws = funnels.filter(f => (f.properties as FunnelProperties).funnelType === 'draw');
  if (saddles.length > 0) elevRange += saddles.length * 8;
  if (draws.length > 0) elevRange += draws.length * 3;
  
  // === Estimate slope std ===
  let slopeStd = 2; // Base estimate (fairly flat)
  // Bedding requires slope variation
  if (bedding.length > 0) {
    const slopeRanges = bedding.map(b => {
      const props = b.properties as BeddingProperties;
      return props.slopeRange ? props.slopeRange[1] - props.slopeRange[0] : 5;
    });
    const avgRange = slopeRanges.reduce((a, b) => a + b, 0) / slopeRanges.length;
    // Slope range correlates with slope std
    slopeStd = avgRange * 0.4;
  }
  // Funnels indicate slope variation
  slopeStd += funnels.length * 0.3;
  slopeStd = Math.min(8, slopeStd);
  
  // === Estimate TPI contrast ===
  // TPI variation correlates with terrain feature diversity
  let tpiContrast = 0.3; // Base
  // Saddles create strong TPI variation
  tpiContrast += saddles.length * 0.15;
  // Draws create moderate TPI variation
  tpiContrast += draws.length * 0.08;
  // Different bedding types indicate varying TPI
  const beddingTypes = new Set(bedding.map(b => (b.properties as BeddingProperties).type));
  tpiContrast += beddingTypes.size * 0.1;
  // Stand TPI variation
  if (stands.length >= 2) {
    const tpis = stands.map(s => {
      const props = s.properties as StandPointProperties;
      return props.tpiLandscape || props.tpiLocal || 0;
    }).filter(t => t !== 0);
    if (tpis.length >= 2) {
      const tpiStd = calculateStd(tpis);
      tpiContrast = Math.max(tpiContrast, tpiStd);
    }
  }
  tpiContrast = Math.min(1.2, tpiContrast);
  
  // === Estimate roughness ===
  // Roughness correlates with slope variation and terrain features
  let roughness = 3; // Base
  // Funnels indicate terrain undulation
  roughness += funnels.length * 0.8;
  // Steep bedding indicates high roughness
  const steepBedding = bedding.filter(b => {
    const props = b.properties as BeddingProperties;
    return props.slopeRange && props.slopeRange[1] > 15;
  });
  roughness += steepBedding.length * 1.5;
  // Scale by parcel size factor
  if (parcelAcres > 100) roughness *= 1.2;
  roughness = Math.min(18, roughness);
  
  return {
    elevRange: Math.round(elevRange * 10) / 10,
    slopeStd: Math.round(slopeStd * 10) / 10,
    tpiContrast: Math.round(tpiContrast * 100) / 100,
    roughness: Math.round(roughness * 10) / 10
  };
}

/**
 * Calculate standard deviation
 */
function calculateStd(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Quality label based on normalized score
 */
function getQualityLabel(normalized: number): string {
  if (normalized >= 0.85) return 'Exceptional terrain diversity';
  if (normalized >= 0.70) return 'High terrain diversity';
  if (normalized >= 0.55) return 'Good terrain diversity';
  if (normalized >= 0.40) return 'Moderate terrain diversity';
  return 'Low terrain diversity';
}
