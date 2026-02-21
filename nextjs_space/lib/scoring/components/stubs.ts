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
