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
 * 
 * V1.0 Status (2026-02-21):
 * - 6/7 components are REAL
 * - Only edge_habitat remains stubbed (requires NLCD landcover)
 */

import type { ComponentInput, ComponentResult } from './types';

// Stub confidence level (low since these are placeholders)
const STUB_CONFIDENCE = 0.30;

/**
 * Stubbed edge habitat - placeholder until NLCD landcover data available
 * 
 * NOTE: Intentionally NOT using terrain-only proxies to avoid
 * double-counting with corridor_coverage and terrain_diversity.
 * Will implement when real landcover source (NLCD) is integrated.
 */
export function stubEdgeHabitat(input: ComponentInput): ComponentResult {
  const { parcelAcres, summary } = input;
  
  // Conservative estimate based on parcel size only
  // (larger parcels tend to have more edge naturally)
  let estimatedScore: number;
  if (parcelAcres >= 200) estimatedScore = 70;
  else if (parcelAcres >= 80) estimatedScore = 60;
  else if (parcelAcres >= 40) estimatedScore = 50;
  else estimatedScore = 40;
  
  // Minor adjustment based on bedding presence (bedding implies cover variation)
  if (summary.totalBeddingAcres > 0) {
    estimatedScore += 5;
  }
  
  estimatedScore = Math.min(100, estimatedScore);
  
  return {
    componentId: 'edge_habitat',
    raw: estimatedScore,
    normalized: estimatedScore / 100,
    unit: 'score',
    notes: `[STUB] Estimated from parcel size (${parcelAcres.toFixed(0)} ac). Requires NLCD landcover for real calculation.`,
    status: 'stubbed',
    confidence: STUB_CONFIDENCE,
    inputsUsed: ['parcel_acreage', 'bedding_presence'],
    metadata: { 
      parcelAcres, 
      hasBedding: summary.totalBeddingAcres > 0,
      pendingDataSource: 'NLCD_2021'
    }
  };
}
