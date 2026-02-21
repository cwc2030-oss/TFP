/**
 * Scoring Aggregator
 * Combines normalized component values with season weights
 * Produces fully explainable scoring breakdowns
 */

import type {
  ComponentNormalizedOutput,
  ComponentWeightedOutput,
  ScoringResult,
  ScoringInput,
  SeasonId,
  ComponentId,
  ValidationResult,
  WeightsConfig
} from './types';
import { getWeights, getSeasonProfile, getComponentDefinition, validateWeightsConfig } from './weight-loader';

/**
 * Calculate letter grade from score
 */
function calculateGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Aggregate normalized component scores into a final weighted score
 */
export function aggregateScores(input: ScoringInput): ScoringResult {
  const config = getWeights();
  const seasonProfile = getSeasonProfile(config, input.season);
  const weights = seasonProfile.weights;
  
  // Validate config
  const validation = validateWeightsConfig(config);
  
  // Build weighted outputs
  const weightedComponents: ComponentWeightedOutput[] = [];
  let totalWeightedScore = 0;
  
  for (const component of input.components) {
    const componentId = component.componentId as ComponentId;
    const weight = weights[componentId];
    
    if (weight === undefined) {
      console.warn(`Unknown component in input: ${componentId}`);
      continue;
    }
    
    const componentDef = getComponentDefinition(config, componentId);
    const weighted = component.normalized * weight;
    totalWeightedScore += weighted;
    
    weightedComponents.push({
      componentId,
      name: componentDef.name,
      raw: component.raw,
      normalized: component.normalized,
      weight,
      weighted,
      unit: component.unit,
      notes: component.notes
    });
  }
  
  // Sort by weight descending for consistent output
  weightedComponents.sort((a, b) => b.weight - a.weight);
  
  return {
    weightsVersion: config.version,
    season: input.season,
    seasonName: seasonProfile.name,
    totalScore: Math.round(totalWeightedScore * 10) / 10,
    grade: calculateGrade(totalWeightedScore),
    components: weightedComponents,
    validation,
    timestamp: new Date().toISOString()
  };
}

/**
 * Normalize a raw value to 0-100 scale
 * Handles inverted components (where lower is better)
 */
export function normalizeValue(
  componentId: ComponentId,
  rawValue: number,
  config?: WeightsConfig
): { normalized: number; notes: string } {
  const weightsConfig = config || getWeights();
  const componentDef = getComponentDefinition(weightsConfig, componentId);
  const [min, max] = componentDef.range;
  
  // Clamp to range
  const clamped = Math.max(min, Math.min(max, rawValue));
  
  // Normalize to 0-1
  let normalized = (clamped - min) / (max - min);
  
  // Invert if necessary (e.g., water_proximity where lower is better)
  if (componentDef.invert) {
    normalized = 1 - normalized;
  }
  
  // Scale to 0-100
  const score = normalized * 100;
  
  // Generate notes
  const notes = generateNotes(componentId, rawValue, score, componentDef);
  
  return {
    normalized: Math.round(score * 10) / 10,
    notes
  };
}

/**
 * Generate human-readable notes for a component score
 */
function generateNotes(
  componentId: ComponentId,
  rawValue: number,
  normalizedScore: number,
  componentDef: { name: string; unit: string; range: [number, number]; invert?: boolean }
): string {
  const qualityLabel = 
    normalizedScore >= 80 ? 'Excellent' :
    normalizedScore >= 60 ? 'Good' :
    normalizedScore >= 40 ? 'Average' :
    normalizedScore >= 20 ? 'Below Average' : 'Poor';
  
  const [min, max] = componentDef.range;
  const rangePosition = ((rawValue - min) / (max - min) * 100).toFixed(0);
  
  return `${qualityLabel} (${rawValue} ${componentDef.unit}, ${rangePosition}% of range)`;
}

/**
 * Create a complete normalized output from raw value
 */
export function createNormalizedOutput(
  componentId: ComponentId,
  rawValue: number,
  config?: WeightsConfig
): ComponentNormalizedOutput {
  const weightsConfig = config || getWeights();
  const componentDef = getComponentDefinition(weightsConfig, componentId);
  const { normalized, notes } = normalizeValue(componentId, rawValue, weightsConfig);
  
  return {
    componentId,
    raw: rawValue,
    normalized,
    unit: componentDef.unit,
    notes
  };
}

/**
 * Convenience function to score from raw values
 */
export function scoreFromRawValues(
  season: SeasonId,
  rawValues: Partial<Record<ComponentId, number>>
): ScoringResult {
  const config = getWeights();
  
  const normalizedComponents: ComponentNormalizedOutput[] = [];
  
  for (const [componentId, rawValue] of Object.entries(rawValues)) {
    if (rawValue !== undefined) {
      normalizedComponents.push(
        createNormalizedOutput(componentId as ComponentId, rawValue, config)
      );
    }
  }
  
  return aggregateScores({
    season,
    components: normalizedComponents
  });
}

/**
 * Get stubbed normalized values for testing
 * Returns deterministic values based on component ID
 */
export function getStubbedNormalizedValues(): ComponentNormalizedOutput[] {
  const config = getWeights();
  const stubValues: Record<ComponentId, number> = {
    bedding_quality: 75,
    funnel_density: 4.5,
    corridor_coverage: 45,
    water_proximity: 250,
    edge_habitat: 68,
    terrain_diversity: 72,
    stand_site_count: 8
  };
  
  return Object.entries(stubValues).map(([componentId, rawValue]) => 
    createNormalizedOutput(componentId as ComponentId, rawValue, config)
  );
}

/**
 * Score with stubbed values (for testing)
 */
export function scoreWithStubs(season: SeasonId): ScoringResult {
  const components = getStubbedNormalizedValues();
  return aggregateScores({ season, components });
}
