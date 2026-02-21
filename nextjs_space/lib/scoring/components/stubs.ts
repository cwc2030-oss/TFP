/**
 * Stubbed Components
 * 
 * Returns deterministic stub values for components not yet implemented.
 * Each stub includes clear notes indicating it's a placeholder.
 * 
 * All stubs have:
 * - status: 'stubbed'
 * - confidence: 0.30 (low confidence for stubs)
 * - inputsUsed: minimal list of what data was used
 */

import type { ComponentInput, ComponentResult, ComponentStatus } from './types';

// Stub confidence level (low since these are placeholders)
const STUB_CONFIDENCE = 0.30;

/**
 * Stubbed funnel density - placeholder until real calculation
 */
export function stubFunnelDensity(input: ComponentInput): ComponentResult {
  const { summary, parcelAcres } = input;
  const funnelCount = summary.funnelCount || 0;
  const density = parcelAcres > 0 ? (funnelCount / parcelAcres) * 40 : 0; // Scale to ~0-10 range
  const clampedDensity = Math.min(10, Math.max(0, density));
  
  return {
    componentId: 'funnel_density',
    raw: Math.round(clampedDensity * 10) / 10,
    normalized: clampedDensity / 10,
    unit: 'features_per_acre',
    notes: `[STUB] ${funnelCount} funnels on ${parcelAcres.toFixed(0)} acres. Real calculation pending.`,
    status: 'stubbed',
    confidence: STUB_CONFIDENCE,
    inputsUsed: ['funnel_count', 'parcel_acreage'],
    metadata: { funnelCount, parcelAcres }
  };
}

/**
 * Stubbed corridor coverage - placeholder until real calculation
 */
export function stubCorridorCoverage(input: ComponentInput): ComponentResult {
  const { layers, parcelAcres } = input;
  const funnels = layers.funnels.features.filter(
    f => (f.properties as any).funnelType === 'corridor'
  );
  
  // Estimate coverage based on corridor count
  const estimatedCoverage = Math.min(100, funnels.length * 8);
  
  return {
    componentId: 'corridor_coverage',
    raw: estimatedCoverage,
    normalized: estimatedCoverage / 100,
    unit: 'percent',
    notes: `[STUB] ${funnels.length} corridors detected. Real coverage calculation pending.`,
    status: 'stubbed',
    confidence: STUB_CONFIDENCE,
    inputsUsed: ['corridor_features', 'parcel_acreage'],
    metadata: { corridorCount: funnels.length, parcelAcres }
  };
}

/**
 * Stubbed edge habitat - placeholder until landcover data available
 */
export function stubEdgeHabitat(input: ComponentInput): ComponentResult {
  const { parcelAcres, summary } = input;
  
  // Estimate based on parcel size (larger parcels tend to have more edge)
  let estimatedScore: number;
  if (parcelAcres >= 200) estimatedScore = 75;
  else if (parcelAcres >= 80) estimatedScore = 65;
  else if (parcelAcres >= 40) estimatedScore = 55;
  else estimatedScore = 45;
  
  // Adjust based on bedding presence (bedding implies cover variation)
  if (summary.totalBeddingAcres > 0) {
    estimatedScore += 10;
  }
  
  estimatedScore = Math.min(100, estimatedScore);
  
  return {
    componentId: 'edge_habitat',
    raw: estimatedScore,
    normalized: estimatedScore / 100,
    unit: 'score',
    notes: `[STUB] Estimated from parcel size (${parcelAcres.toFixed(0)} ac). Real landcover analysis pending.`,
    status: 'stubbed',
    confidence: STUB_CONFIDENCE,
    inputsUsed: ['parcel_acreage', 'bedding_presence'],
    metadata: { parcelAcres, hasBedding: summary.totalBeddingAcres > 0 }
  };
}

/**
 * Stubbed terrain diversity - placeholder until full DEM analysis
 */
export function stubTerrainDiversity(input: ComponentInput): ComponentResult {
  const { layers, summary, parcelAcres } = input;
  
  // Estimate from available terrain features
  let score = 50; // Base score
  
  // More funnels = more terrain variation
  if (summary.funnelCount >= 10) score += 20;
  else if (summary.funnelCount >= 5) score += 15;
  else if (summary.funnelCount >= 2) score += 10;
  
  // More bedding types = more terrain variety
  const beddingTypes = new Set(
    layers.beddingPolygons.features.map(f => f.properties.type)
  );
  score += beddingTypes.size * 5;
  
  // Larger parcels more likely to have diverse terrain
  if (parcelAcres >= 160) score += 10;
  else if (parcelAcres >= 80) score += 5;
  
  score = Math.min(100, Math.max(0, score));
  
  return {
    componentId: 'terrain_diversity',
    raw: score,
    normalized: score / 100,
    unit: 'score',
    notes: `[STUB] Estimated from ${summary.funnelCount} funnels, ${beddingTypes.size} bedding types. Full DEM analysis pending.`,
    status: 'stubbed',
    confidence: STUB_CONFIDENCE,
    inputsUsed: ['funnel_count', 'bedding_types', 'parcel_acreage'],
    metadata: {
      funnelCount: summary.funnelCount,
      beddingTypeCount: beddingTypes.size,
      parcelAcres
    }
  };
}

/**
 * Stubbed stand site count - uses actual count but marks as stub
 * since ranking/filtering logic not yet finalized
 */
export function stubStandSiteCount(input: ComponentInput): ComponentResult {
  const { layers } = input;
  const standCount = layers.standPoints.features.length;
  
  // Range is 0-20, so normalize by /20
  const clampedCount = Math.min(20, Math.max(0, standCount));
  
  // Slightly higher confidence since we use actual stand data
  const confidence = 0.50;
  
  return {
    componentId: 'stand_site_count',
    raw: clampedCount,
    normalized: clampedCount / 20,
    unit: 'count',
    notes: `${standCount} stand sites identified. Ranking methodology being refined.`,
    status: 'stubbed',
    confidence,
    inputsUsed: ['stand_points'],
    metadata: { rawCount: standCount }
  };
}
