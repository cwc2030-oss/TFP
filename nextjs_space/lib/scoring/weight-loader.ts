/**
 * Weight Loader with Validation
 * Loads YAML weights files and validates sum-to-1 constraint
 */

import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import type { 
  WeightsConfig, 
  SeasonId, 
  ComponentId, 
  ValidationResult,
  SeasonProfile,
  ComponentDefinition
} from './types';

// Tolerance for floating point comparison
const WEIGHT_SUM_TOLERANCE = 0.0001;
const EXPECTED_WEIGHT_SUM = 1.0;

/**
 * Validates that weights sum to 1.0 for a season
 */
function validateWeightSum(weights: Record<string, number>, seasonId: string): ValidationResult {
  const sum = Object.values(weights).reduce((acc, w) => acc + w, 0);
  const valid = Math.abs(sum - EXPECTED_WEIGHT_SUM) < WEIGHT_SUM_TOLERANCE;
  
  return {
    valid,
    weightSum: sum,
    errors: valid ? [] : [
      `Season '${seasonId}' weights sum to ${sum.toFixed(6)}, expected ${EXPECTED_WEIGHT_SUM}`
    ]
  };
}

/**
 * Validates all seasons in a weights config
 */
function validateAllSeasons(config: WeightsConfig): ValidationResult {
  const allErrors: string[] = [];
  let allValid = true;
  let lastSum = 0;

  for (const [seasonId, season] of Object.entries(config.seasons)) {
    const result = validateWeightSum(season.weights, seasonId);
    if (!result.valid) {
      allValid = false;
      allErrors.push(...result.errors);
    }
    lastSum = result.weightSum;
  }

  // Validate all components are present in each season
  const componentIds = Object.keys(config.components);
  for (const [seasonId, season] of Object.entries(config.seasons)) {
    const seasonWeightKeys = Object.keys(season.weights);
    const missingComponents = componentIds.filter(c => !seasonWeightKeys.includes(c));
    const extraComponents = seasonWeightKeys.filter(c => !componentIds.includes(c));
    
    if (missingComponents.length > 0) {
      allValid = false;
      allErrors.push(`Season '${seasonId}' missing weights for: ${missingComponents.join(', ')}`);
    }
    if (extraComponents.length > 0) {
      allValid = false;
      allErrors.push(`Season '${seasonId}' has unknown components: ${extraComponents.join(', ')}`);
    }
  }

  return {
    valid: allValid,
    weightSum: lastSum,
    errors: allErrors
  };
}

/**
 * Load weights from YAML file
 */
export function loadWeights(version: string = 'v1_0'): WeightsConfig {
  const weightsPath = path.join(
    process.cwd(), 
    'lib', 
    'scoring', 
    'weights', 
    `${version}.yaml`
  );
  
  if (!fs.existsSync(weightsPath)) {
    throw new Error(`Weights file not found: ${weightsPath}`);
  }
  
  const fileContents = fs.readFileSync(weightsPath, 'utf8');
  const config = yaml.load(fileContents) as WeightsConfig;
  
  // Validate
  const validation = validateAllSeasons(config);
  if (!validation.valid) {
    throw new Error(
      `Invalid weights configuration:\n${validation.errors.join('\n')}`
    );
  }
  
  return config;
}

/**
 * Get weights for a specific season
 */
export function getSeasonWeights(
  config: WeightsConfig, 
  season: SeasonId
): Record<ComponentId, number> {
  const seasonProfile = config.seasons[season];
  if (!seasonProfile) {
    throw new Error(`Unknown season: ${season}`);
  }
  return seasonProfile.weights;
}

/**
 * Get component definition
 */
export function getComponentDefinition(
  config: WeightsConfig,
  componentId: ComponentId
): ComponentDefinition {
  const component = config.components[componentId];
  if (!component) {
    throw new Error(`Unknown component: ${componentId}`);
  }
  return component;
}

/**
 * Get season profile
 */
export function getSeasonProfile(
  config: WeightsConfig,
  season: SeasonId
): SeasonProfile {
  const profile = config.seasons[season];
  if (!profile) {
    throw new Error(`Unknown season: ${season}`);
  }
  return profile;
}

/**
 * Validate a weights config (for testing/debugging)
 */
export function validateWeightsConfig(config: WeightsConfig): ValidationResult {
  return validateAllSeasons(config);
}

// Singleton cache for loaded weights
let cachedWeights: WeightsConfig | null = null;
let cachedVersion: string | null = null;

/**
 * Get weights with caching
 */
export function getWeights(version: string = 'v1_0'): WeightsConfig {
  if (cachedWeights && cachedVersion === version) {
    return cachedWeights;
  }
  
  cachedWeights = loadWeights(version);
  cachedVersion = version;
  return cachedWeights;
}

/**
 * Clear weights cache (for testing)
 */
export function clearWeightsCache(): void {
  cachedWeights = null;
  cachedVersion = null;
}
