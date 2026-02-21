/**
 * Bedding Quality Component
 * 
 * Calculates bedding area quality from DEM-derived bedding polygons.
 * Uses slope, aspect, area density, and type distribution.
 * 
 * Scoring factors (weighted):
 * - Bedding density (acres/parcel acre): 30%
 * - Bedding diversity (type distribution): 25%
 * - Thermal bedding ratio (S/SW facing): 25%
 * - Average confidence: 20%
 * 
 * Normalization: 0-100 scale
 */

import type { ComponentInput, ComponentResult, BeddingMetrics } from './types';
import type { BeddingProperties } from '@/types/terrain';

// Weights for bedding quality sub-factors
const WEIGHT_DENSITY = 0.30;
const WEIGHT_DIVERSITY = 0.25;
const WEIGHT_THERMAL = 0.25;
const WEIGHT_CONFIDENCE = 0.20;

// Density scoring thresholds (acres of bedding per parcel acre)
const EXCELLENT_DENSITY = 0.15; // 15% of parcel is bedding = 100
const GOOD_DENSITY = 0.08;      // 8% = 70
const ADEQUATE_DENSITY = 0.04; // 4% = 50

// Thermal bedding ratio thresholds (S/SW facing as % of total)
const EXCELLENT_THERMAL_RATIO = 0.40; // 40% thermal = 100
const GOOD_THERMAL_RATIO = 0.25;      // 25% = 70

/**
 * Calculate bedding quality score from terrain analysis data
 */
export function calculateBeddingQuality(input: ComponentInput): ComponentResult {
  const { layers, summary, parcelAcres } = input;
  const beddingFeatures = layers.beddingPolygons.features;
  
  // Handle no bedding case
  if (beddingFeatures.length === 0) {
    return {
      componentId: 'bedding_quality',
      raw: 0,
      normalized: 0,
      unit: 'score',
      notes: 'No bedding areas detected. Property may lack suitable terrain for deer bedding.',
      dataSource: 'real',
      metadata: {
        polygonCount: 0,
        totalAcres: 0,
        method: 'terrain_analysis'
      }
    };
  }
  
  // Compute bedding metrics
  const metrics = computeBeddingMetrics(beddingFeatures, parcelAcres);
  
  // Score each sub-factor (0-100)
  const densityScore = scoreDensity(metrics.totalAcres, parcelAcres);
  const diversityScore = scoreDiversity(metrics);
  const thermalScore = scoreThermalBedding(metrics);
  const confidenceScore = metrics.avgConfidence * 100;
  
  // Weighted aggregate
  const rawScore = 
    densityScore * WEIGHT_DENSITY +
    diversityScore * WEIGHT_DIVERSITY +
    thermalScore * WEIGHT_THERMAL +
    confidenceScore * WEIGHT_CONFIDENCE;
  
  // Normalize to 0-1
  const normalized = Math.min(1, Math.max(0, rawScore / 100));
  
  // Generate explanatory notes
  const notes = generateNotes(metrics, densityScore, diversityScore, thermalScore, parcelAcres);
  
  return {
    componentId: 'bedding_quality',
    raw: Math.round(rawScore),
    normalized: Math.round(normalized * 10000) / 10000,
    unit: 'score',
    notes,
    dataSource: 'real',
    metadata: {
      ...metrics,
      subScores: {
        density: Math.round(densityScore),
        diversity: Math.round(diversityScore),
        thermal: Math.round(thermalScore),
        confidence: Math.round(confidenceScore)
      },
      weights: {
        density: WEIGHT_DENSITY,
        diversity: WEIGHT_DIVERSITY,
        thermal: WEIGHT_THERMAL,
        confidence: WEIGHT_CONFIDENCE
      },
      method: 'terrain_analysis'
    }
  };
}

/**
 * Compute aggregate metrics from bedding polygons
 */
function computeBeddingMetrics(
  features: GeoJSON.Feature<GeoJSON.Polygon, BeddingProperties>[],
  parcelAcres: number
): BeddingMetrics {
  let totalAcres = 0;
  let thermalAcres = 0;
  let transitionAcres = 0;
  let escapeAcres = 0;
  let totalConfidence = 0;
  let totalSlopeDegrees = 0;
  const aspects: Record<string, number> = {};
  
  for (const feature of features) {
    const props = feature.properties;
    const acres = props.areaAcres;
    
    totalAcres += acres;
    totalConfidence += props.confidence;
    
    // Average slope from range
    const avgSlope = (props.slopeRange[0] + props.slopeRange[1]) / 2;
    totalSlopeDegrees += avgSlope;
    
    // Count aspects
    aspects[props.aspect] = (aspects[props.aspect] || 0) + acres;
    
    // Categorize by type
    switch (props.type) {
      case 'thermal_bedding':
        thermalAcres += acres;
        break;
      case 'transition_bedding':
        transitionAcres += acres;
        break;
      case 'escape_cover':
        escapeAcres += acres;
        break;
    }
  }
  
  // Find dominant aspect
  let dominantAspect = 'N';
  let maxAspectAcres = 0;
  for (const [aspect, acres] of Object.entries(aspects)) {
    if (acres > maxAspectAcres) {
      dominantAspect = aspect;
      maxAspectAcres = acres;
    }
  }
  
  return {
    totalAcres,
    polygonCount: features.length,
    avgConfidence: totalConfidence / features.length,
    thermalBeddingAcres: thermalAcres,
    transitionBeddingAcres: transitionAcres,
    escapeCoverAcres: escapeAcres,
    avgSlopeDegrees: totalSlopeDegrees / features.length,
    dominantAspect
  };
}

/**
 * Score bedding density (acres of bedding per parcel acre)
 */
function scoreDensity(beddingAcres: number, parcelAcres: number): number {
  const density = beddingAcres / parcelAcres;
  
  if (density >= EXCELLENT_DENSITY) return 100;
  if (density >= GOOD_DENSITY) {
    // Linear interpolation 70-100
    return 70 + 30 * (density - GOOD_DENSITY) / (EXCELLENT_DENSITY - GOOD_DENSITY);
  }
  if (density >= ADEQUATE_DENSITY) {
    // Linear interpolation 50-70
    return 50 + 20 * (density - ADEQUATE_DENSITY) / (GOOD_DENSITY - ADEQUATE_DENSITY);
  }
  // Below adequate: 0-50
  return 50 * (density / ADEQUATE_DENSITY);
}

/**
 * Score bedding diversity (presence of multiple types)
 */
function scoreDiversity(metrics: BeddingMetrics): number {
  const types: number[] = [];
  if (metrics.thermalBeddingAcres > 0) types.push(metrics.thermalBeddingAcres);
  if (metrics.transitionBeddingAcres > 0) types.push(metrics.transitionBeddingAcres);
  if (metrics.escapeCoverAcres > 0) types.push(metrics.escapeCoverAcres);
  
  if (types.length === 0) return 0;
  if (types.length === 1) return 40; // Only one type
  if (types.length === 2) return 70; // Two types
  
  // All three types - score based on balance
  const total = metrics.totalAcres;
  const ratios = types.map(t => t / total);
  const minRatio = Math.min(...ratios);
  
  // Perfect balance would be 0.33 each
  // Score higher if more balanced
  if (minRatio >= 0.20) return 100; // Well balanced
  if (minRatio >= 0.10) return 85;  // Reasonably balanced
  return 70; // Has all types but unbalanced
}

/**
 * Score thermal bedding ratio (S/SW facing for winter warmth)
 */
function scoreThermalBedding(metrics: BeddingMetrics): number {
  if (metrics.totalAcres === 0) return 0;
  
  const thermalRatio = metrics.thermalBeddingAcres / metrics.totalAcres;
  
  if (thermalRatio >= EXCELLENT_THERMAL_RATIO) return 100;
  if (thermalRatio >= GOOD_THERMAL_RATIO) {
    return 70 + 30 * (thermalRatio - GOOD_THERMAL_RATIO) / (EXCELLENT_THERMAL_RATIO - GOOD_THERMAL_RATIO);
  }
  // Below good threshold
  return 70 * (thermalRatio / GOOD_THERMAL_RATIO);
}

/**
 * Generate human-readable notes
 */
function generateNotes(
  metrics: BeddingMetrics,
  densityScore: number,
  diversityScore: number,
  thermalScore: number,
  parcelAcres: number
): string {
  const density = (metrics.totalAcres / parcelAcres * 100).toFixed(1);
  const thermalPct = metrics.totalAcres > 0 
    ? (metrics.thermalBeddingAcres / metrics.totalAcres * 100).toFixed(0)
    : '0';
  
  // Determine primary strength/weakness
  const scores = [
    { name: 'density', score: densityScore },
    { name: 'diversity', score: diversityScore },
    { name: 'thermal', score: thermalScore }
  ].sort((a, b) => b.score - a.score);
  
  const strength = scores[0].name;
  const weakness = scores[2].name;
  
  let qualityLabel: string;
  const avgScore = (densityScore + diversityScore + thermalScore) / 3;
  if (avgScore >= 85) qualityLabel = 'Excellent';
  else if (avgScore >= 70) qualityLabel = 'Good';
  else if (avgScore >= 55) qualityLabel = 'Average';
  else if (avgScore >= 40) qualityLabel = 'Below average';
  else qualityLabel = 'Limited';
  
  return `${qualityLabel}: ${metrics.polygonCount} bedding areas (${metrics.totalAcres.toFixed(1)} ac, ${density}% of parcel). ` +
    `${thermalPct}% thermal (S/SW facing), dominant aspect ${metrics.dominantAspect}. ` +
    `Strength: ${strength}. Area for improvement: ${weakness}.`;
}
