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
