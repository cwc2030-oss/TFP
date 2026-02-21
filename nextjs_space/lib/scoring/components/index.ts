/**
 * Scoring Components Registry
 * 
 * Exports all component calculators and provides a unified interface
 * for computing all component scores from terrain analysis data.
 */

import type { ComponentInput, ComponentResult } from './types';
import type { ComponentNormalizedOutput, ComponentId } from '../types';
import { calculateWaterProximity } from './water-proximity';
import { calculateBeddingQuality } from './bedding-quality';
import {
  stubFunnelDensity,
  stubCorridorCoverage,
  stubEdgeHabitat,
  stubTerrainDiversity,
  stubStandSiteCount
} from './stubs';

export type { ComponentInput, ComponentResult, BeddingMetrics, StandMetrics, HydroFeatures } from './types';

// Re-export individual calculators
export { calculateWaterProximity } from './water-proximity';
export { calculateBeddingQuality } from './bedding-quality';
export {
  stubFunnelDensity,
  stubCorridorCoverage,
  stubEdgeHabitat,
  stubTerrainDiversity,
  stubStandSiteCount
} from './stubs';

/**
 * Component calculator registry
 * Maps component IDs to their calculation functions
 */
const COMPONENT_CALCULATORS: Record<ComponentId, (input: ComponentInput) => ComponentResult> = {
  water_proximity: calculateWaterProximity,
  bedding_quality: calculateBeddingQuality,
  funnel_density: stubFunnelDensity,
  corridor_coverage: stubCorridorCoverage,
  edge_habitat: stubEdgeHabitat,
  terrain_diversity: stubTerrainDiversity,
  stand_site_count: stubStandSiteCount
};

/**
 * Component implementation status
 */
export const COMPONENT_STATUS: Record<ComponentId, 'real' | 'stubbed'> = {
  water_proximity: 'real',
  bedding_quality: 'real',
  funnel_density: 'stubbed',
  corridor_coverage: 'stubbed',
  edge_habitat: 'stubbed',
  terrain_diversity: 'stubbed',
  stand_site_count: 'stubbed'
};

/**
 * Calculate all component scores from terrain analysis input
 * Returns deterministic results in consistent order
 */
export function calculateAllComponents(input: ComponentInput): ComponentResult[] {
  const componentIds: ComponentId[] = [
    'bedding_quality',
    'funnel_density',
    'corridor_coverage',
    'water_proximity',
    'edge_habitat',
    'terrain_diversity',
    'stand_site_count'
  ];
  
  return componentIds.map(id => COMPONENT_CALCULATORS[id](input));
}

/**
 * Calculate a single component score
 */
export function calculateComponent(componentId: ComponentId, input: ComponentInput): ComponentResult {
  const calculator = COMPONENT_CALCULATORS[componentId];
  if (!calculator) {
    throw new Error(`Unknown component: ${componentId}`);
  }
  return calculator(input);
}

/**
 * Convert ComponentResult to ComponentNormalizedOutput for aggregator
 */
export function toNormalizedOutput(result: ComponentResult): ComponentNormalizedOutput {
  return {
    componentId: result.componentId,
    raw: result.raw,
    normalized: result.normalized,
    unit: result.unit,
    notes: result.notes
  };
}

/**
 * Calculate all components and convert to normalized outputs
 */
export function calculateNormalizedComponents(input: ComponentInput): ComponentNormalizedOutput[] {
  return calculateAllComponents(input).map(toNormalizedOutput);
}
