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
 * Calculate letter grade from score (forgiving bands)
 * A ≥ 85, B ≥ 70, C ≥ 55, D ≥ 40, F < 40
 */
function calculateGrade(score: number): string {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/**
 * Aggregate normalized component scores into a final weighted score
 * 
 * Formula: totalScore = 100 * sum(normalized_i * weight_i)
 * where normalized_i is 0-1 and weights sum to 1
 */
export function aggregateScores(input: ScoringInput): ScoringResult {
  const config = getWeights();
  const seasonProfile = getSeasonProfile(config, input.season);
  const weights = seasonProfile.weights;
  
  // Validate config
  const validation = validateWeightsConfig(config);
  
  // Build weighted outputs and track status
  const weightedComponents: ComponentWeightedOutput[] = [];
  let sumWeighted = 0;
  let sumWeightedConfidence = 0;
  
  // Status breakdown tracking
  const statusBreakdown = {
    real: 0,
    estimated: 0,
    stubbed: 0,
    realComponents: [] as string[],
    estimatedComponents: [] as string[],
    stubbedComponents: [] as string[]
  };
  
  for (const component of input.components) {
    const componentId = component.componentId as ComponentId;
    const weight = weights[componentId];
    
    if (weight === undefined) {
      console.warn(`Unknown component in input: ${componentId}`);
      continue;
    }
    
    const componentDef = getComponentDefinition(config, componentId);
    // weighted = normalized (0-1) * weight (0-1)
    const weighted = component.normalized * weight;
    sumWeighted += weighted;
    
    // Track confidence weighted by component weight
    const confidence = component.confidence ?? 0.5;
    sumWeightedConfidence += confidence * weight;
    
    // Track status
    const status = component.status ?? 'stubbed';
    statusBreakdown[status]++;
    if (status === 'real') statusBreakdown.realComponents.push(componentId);
    else if (status === 'estimated') statusBreakdown.estimatedComponents.push(componentId);
    else statusBreakdown.stubbedComponents.push(componentId);
    
    weightedComponents.push({
      componentId,
      name: componentDef.name,
      raw: component.raw,
      normalized: component.normalized,
      normalized100: Math.round(component.normalized * 1000) / 10, // 0-100 for UI
      weight,
      weighted,
      unit: component.unit,
      notes: component.notes,
      status,
      confidence,
      inputsUsed: component.inputsUsed ?? []
    });
  }
  
  // Sort by weight descending for consistent output
  weightedComponents.sort((a, b) => b.weight - a.weight);
  
  // totalScore = 100 * sum(weighted)
  const totalScore = Math.round(sumWeighted * 1000) / 10;
  
  // Overall confidence = weighted average of component confidences
  const overallConfidence = Math.round(sumWeightedConfidence * 100) / 100;
  
  return {
    weightsVersion: config.version,
    season: input.season,
    seasonName: seasonProfile.name,
    totalScore,
    grade: calculateGrade(totalScore),
    components: weightedComponents,
    validation,
    timestamp: new Date().toISOString(),
    overallConfidence,
    statusBreakdown
  };
}

/**
 * Normalize a raw value to 0-1 scale
 * Handles inverted components (where lower is better)
 * 
 * Normalization ranges:
 * - funnel_density: /10
 * - corridor_coverage: /100
 * - water_proximity: inverted, 0-1000m
 * - stand_site_count: /20
 * - others: /100
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
  
  // Generate notes using 0-100 scale for human readability
  const normalized100 = normalized * 100;
  const notes = generateNotes(componentId, rawValue, normalized100, componentDef);
  
  return {
    // Return 0-1 scale, rounded to 4 decimal places for precision
    normalized: Math.round(normalized * 10000) / 10000,
    notes
  };
}

/**
 * Generate human-readable notes for a component score
 * Uses 0-100 scale for display
 */
function generateNotes(
  componentId: ComponentId,
  rawValue: number,
  normalized100: number,
  componentDef: { name: string; unit: string; range: [number, number]; invert?: boolean }
): string {
  // Forgiving quality labels matching grade bands
  const qualityLabel = 
    normalized100 >= 85 ? 'Excellent' :
    normalized100 >= 70 ? 'Good' :
    normalized100 >= 55 ? 'Average' :
    normalized100 >= 40 ? 'Below Average' : 'Poor';
  
  const [min, max] = componentDef.range;
  const rangePosition = ((rawValue - min) / (max - min) * 100).toFixed(0);
  
  return `${qualityLabel} (${rawValue} ${componentDef.unit}, ${rangePosition}% of range)`;
}

/**
 * Create a complete normalized output from raw value
 * Note: This marks the output as 'estimated' since we don't have
 * full component provenance from raw values alone.
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
    notes,
    // Mark as estimated since this is from raw values, not full analysis
    status: 'estimated',
    confidence: 0.5,
    inputsUsed: ['raw_value']
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
