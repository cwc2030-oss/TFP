/**
 * Terra Firma Scoring System
 * 
 * Exports the public API for terrain analysis scoring
 */

// Types
export type {
  ComponentRawOutput,
  ComponentNormalizedOutput,
  ComponentWeightedOutput,
  ScoringResult,
  ScoringInput,
  ValidationResult,
  SeasonId,
  ComponentId,
  ComponentDefinition,
  SeasonProfile,
  WeightsConfig
} from './types';

// Weight loading
export {
  loadWeights,
  getWeights,
  getSeasonWeights,
  getSeasonProfile,
  getComponentDefinition,
  validateWeightsConfig,
  clearWeightsCache
} from './weight-loader';

// Scoring
export {
  aggregateScores,
  normalizeValue,
  createNormalizedOutput,
  scoreFromRawValues,
  getStubbedNormalizedValues,
  scoreWithStubs
} from './aggregator';

// Components
export type {
  ComponentInput,
  ComponentResult,
  BeddingMetrics,
  StandMetrics,
  HydroFeatures
} from './components';

export {
  calculateAllComponents,
  calculateComponent,
  calculateNormalizedComponents,
  toNormalizedOutput,
  calculateWaterProximity,
  calculateBeddingQuality,
  COMPONENT_STATUS
} from './components';

// Convenience function: score terrain analysis directly
import type { TerrainLayers, TerrainSummary } from '@/types/terrain';
import type { SeasonId, ScoringResult } from './types';
import { aggregateScores } from './aggregator';
import { calculateNormalizedComponents } from './components';
import type { ComponentInput } from './components';

/**
 * Score terrain analysis results directly
 * Combines component calculation and aggregation in one call
 */
export function scoreTerrainAnalysis(
  layers: TerrainLayers,
  summary: TerrainSummary,
  parcelAcres: number,
  centroid: [number, number],
  season: SeasonId
): ScoringResult {
  const input: ComponentInput = {
    layers,
    summary,
    parcelAcres,
    centroid
  };
  
  const components = calculateNormalizedComponents(input);
  
  return aggregateScores({
    season,
    components
  });
}
