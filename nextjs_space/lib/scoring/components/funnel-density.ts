/**
 * Funnel Density Component
 * 
 * Calculates the density of terrain-derived funnel features per 100 acres.
 * Funnels include saddles (topographic pinch points) and convergence lines
 * (draws/corridors where deer movement naturally concentrates).
 * 
 * Normalization: clamp01(funnels_per_100_acres / 8)
 * - 8 funnels/100ac is the high-density benchmark
 * - A 40-acre parcel with 3 funnels = 7.5/100ac ≈ 93.75%
 * - A 400-acre parcel with 30 funnels = 7.5/100ac ≈ 93.75% (same density)
 * 
 * This per-100-acre normalization prevents big parcels from auto-scoring higher.
 * 
 * Real data: Uses actual geoprocessor funnel features (status='real')
 * Estimated: Falls back to stand-derived indicators if funnels missing
 */

import type { ComponentInput, ComponentResult, ComponentStatus } from './types';
import type { FunnelProperties, FunnelType } from '@/types/terrain';

// ============ Constants ============

/** Benchmark: high-density funnel count per 100 acres */
const FUNNELS_PER_100_ACRES_BENCHMARK = 8;

/** Confidence levels by data source */
const CONFIDENCE_REAL = 0.90;
const CONFIDENCE_ESTIMATED = 0.55;

/** Cap for estimated data (can't exceed 70% normalized) */
const ESTIMATED_NORMALIZED_CAP = 0.70;

/** Funnel types that count as terrain-derived movement funnels */
const FUNNEL_TYPES: FunnelType[] = ['saddle', 'draw', 'corridor'];

/** Weight by funnel type (saddles are most significant) */
const FUNNEL_TYPE_WEIGHTS: Record<FunnelType, number> = {
  saddle: 1.5,    // Saddles are prime funnel terrain
  draw: 1.0,      // Draws are standard funnels
  corridor: 0.8   // Corridors are often longer/less concentrated
};

/** Minimum corridor score to count as significant funnel */
const MIN_CORRIDOR_SCORE = 0.3;

// ============ Main Calculator ============

/**
 * Calculate funnel density from terrain analysis data
 * 
 * Steps:
 * 1. Extract and count funnel features by type (saddle, draw, corridor)
 * 2. Apply type-specific weights to get effective funnel count
 * 3. Calculate funnels_per_acre = weighted_count / parcel_acres
 * 4. Normalize: clamp01(funnels_per_acre / 0.08)
 */
export function calculateFunnelDensity(input: ComponentInput): ComponentResult {
  const { layers, summary, parcelAcres } = input;
  const funnelFeatures = layers.funnels.features;
  
  // Guard against zero acres
  if (parcelAcres <= 0) {
    return createErrorResult('Invalid parcel acreage (≤0)');
  }
  
  // ============ Step 1: Count and categorize funnels ============
  const funnelsByType = categorizeFunnels(funnelFeatures);
  const totalRawCount = Object.values(funnelsByType).reduce((sum, arr) => sum + arr.length, 0);
  
  // ============ Step 2: Calculate weighted funnel count ============
  const { weightedCount, breakdown } = calculateWeightedCount(funnelsByType);
  
  // ============ Step 3: Determine data status ============
  let status: ComponentStatus;
  let confidence: number;
  let inputsUsed: string[];
  
  if (totalRawCount > 0) {
    // Real terrain-derived funnels from geoprocessor
    status = 'real';
    confidence = CONFIDENCE_REAL;
    inputsUsed = ['terrain_funnels', 'parcel_boundary'];
  } else {
    // No funnels detected - estimate from stand site data
    status = 'estimated';
    confidence = CONFIDENCE_ESTIMATED;
    inputsUsed = ['stand_points', 'parcel_acreage'];
  }
  
  // ============ Step 4: Calculate density per 100 acres ============
  // Normalize to per-100-acres so big parcels don't auto-score higher
  const funnelsPer100Acres = (weightedCount / parcelAcres) * 100;
  
  // ============ Step 5: Normalize ============
  let normalized = clamp01(funnelsPer100Acres / FUNNELS_PER_100_ACRES_BENCHMARK);
  
  // Cap estimated data to prevent overstating
  if (status === 'estimated' && normalized > ESTIMATED_NORMALIZED_CAP) {
    normalized = ESTIMATED_NORMALIZED_CAP;
  }
  
  // ============ Step 6: Generate notes ============
  const notes = generateNotes({
    totalRawCount,
    weightedCount,
    funnelsPer100Acres,
    parcelAcres,
    breakdown,
    status,
    normalized
  });
  
  // ============ Step 7: Quality label ============
  const qualityLabel = getQualityLabel(normalized);
  const fullNotes = `${qualityLabel}. ${notes}`;
  
  return {
    componentId: 'funnel_density',
    raw: Math.round(funnelsPer100Acres * 100) / 100, // 2 decimal precision
    normalized: Math.round(normalized * 10000) / 10000,
    unit: 'funnels_per_100_acres',
    notes: fullNotes,
    status,
    confidence,
    inputsUsed,
    metadata: {
      totalRawCount,
      weightedCount: Math.round(weightedCount * 100) / 100,
      funnelsPer100Acres: Math.round(funnelsPer100Acres * 100) / 100,
      parcelAcres: Math.round(parcelAcres * 10) / 10,
      breakdown,
      benchmark: FUNNELS_PER_100_ACRES_BENCHMARK
    }
  };
}

// ============ Helper Functions ============

/**
 * Categorize funnel features by type
 */
function categorizeFunnels(
  features: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties>[]
): Record<FunnelType, GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties>[]> {
  const result: Record<FunnelType, GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties>[]> = {
    saddle: [],
    draw: [],
    corridor: []
  };
  
  for (const feature of features) {
    const props = feature.properties;
    const funnelType = props.funnelType;
    
    // Filter out low-quality corridors
    if (funnelType === 'corridor' && (props.corridorScore || 0) < MIN_CORRIDOR_SCORE) {
      continue;
    }
    
    if (FUNNEL_TYPES.includes(funnelType)) {
      result[funnelType].push(feature);
    }
  }
  
  return result;
}

/**
 * Calculate weighted funnel count based on type significance
 */
function calculateWeightedCount(
  funnelsByType: Record<FunnelType, GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties>[]>
): { weightedCount: number; breakdown: Record<FunnelType, { count: number; weighted: number }> } {
  const breakdown: Record<FunnelType, { count: number; weighted: number }> = {
    saddle: { count: 0, weighted: 0 },
    draw: { count: 0, weighted: 0 },
    corridor: { count: 0, weighted: 0 }
  };
  
  let totalWeighted = 0;
  
  for (const funnelType of FUNNEL_TYPES) {
    const features = funnelsByType[funnelType];
    const count = features.length;
    const weight = FUNNEL_TYPE_WEIGHTS[funnelType];
    
    // For corridors, factor in corridor score
    let weighted: number;
    if (funnelType === 'corridor') {
      // Sum corridor scores * weight
      weighted = features.reduce((sum, f) => {
        const score = f.properties.corridorScore || 0.5;
        return sum + (score * weight);
      }, 0);
    } else {
      weighted = count * weight;
    }
    
    breakdown[funnelType] = {
      count,
      weighted: Math.round(weighted * 100) / 100
    };
    totalWeighted += weighted;
  }
  
  return {
    weightedCount: totalWeighted,
    breakdown
  };
}

/**
 * Clamp value to 0-1 range
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Generate human-readable notes
 */
function generateNotes(params: {
  totalRawCount: number;
  weightedCount: number;
  funnelsPer100Acres: number;
  parcelAcres: number;
  breakdown: Record<FunnelType, { count: number; weighted: number }>;
  status: ComponentStatus;
  normalized: number;
}): string {
  const {
    totalRawCount,
    funnelsPer100Acres,
    parcelAcres,
    breakdown,
    status
  } = params;
  
  if (totalRawCount === 0) {
    return `No terrain funnels detected on ${Math.round(parcelAcres)} acres. Density: 0/100ac.`;
  }
  
  // Build breakdown string
  const parts: string[] = [];
  if (breakdown.saddle.count > 0) {
    parts.push(`${breakdown.saddle.count} saddle${breakdown.saddle.count > 1 ? 's' : ''}`);
  }
  if (breakdown.draw.count > 0) {
    parts.push(`${breakdown.draw.count} draw${breakdown.draw.count > 1 ? 's' : ''}`);
  }
  if (breakdown.corridor.count > 0) {
    parts.push(`${breakdown.corridor.count} corridor${breakdown.corridor.count > 1 ? 's' : ''}`);
  }
  
  const featureList = parts.join(', ');
  const densityStr = funnelsPer100Acres.toFixed(1);
  
  let note = `${totalRawCount} funnel features (${featureList}) on ${Math.round(parcelAcres)} acres. `;
  note += `Density: ${densityStr}/100ac (benchmark: ${FUNNELS_PER_100_ACRES_BENCHMARK}).`;
  
  if (status === 'estimated') {
    note += ` [estimated, capped at ${Math.round(ESTIMATED_NORMALIZED_CAP * 100)}%]`;
  }
  
  return note;
}

/**
 * Quality label based on normalized score
 */
function getQualityLabel(normalized: number): string {
  if (normalized >= 0.85) return 'Excellent funnel density';
  if (normalized >= 0.70) return 'Good funnel density';
  if (normalized >= 0.50) return 'Moderate funnel density';
  if (normalized >= 0.30) return 'Low funnel density';
  return 'Minimal funnel terrain';
}

/**
 * Create error result for edge cases
 */
function createErrorResult(message: string): ComponentResult {
  return {
    componentId: 'funnel_density',
    raw: 0,
    normalized: 0,
    unit: 'funnels_per_acre',
    notes: `Error: ${message}`,
    status: 'stubbed',
    confidence: 0,
    inputsUsed: [],
    metadata: { error: message }
  };
}
