/**
 * Terra Firma Scoring System Types
 * Defines the contract for component outputs and scoring results
 */

// ============ Component Output Contract ============

/**
 * Raw component output from terrain analysis
 * This is what each analysis component produces
 */
export interface ComponentRawOutput {
  /** Unique component identifier */
  componentId: string;
  /** Raw measured value in native units */
  rawValue: number;
  /** Unit of measurement */
  unit: string;
  /** Optional metadata about the measurement */
  metadata?: Record<string, unknown>;
}

/**
 * Normalized component output (0-100 scale)
 * Produced by normalizing raw values against component ranges
 */
export interface ComponentNormalizedOutput {
  /** Unique component identifier */
  componentId: string;
  /** Original raw value */
  raw: number;
  /** Normalized value (0-100) */
  normalized: number;
  /** Unit of the raw measurement */
  unit: string;
  /** Human-readable explanation of the score */
  notes: string;
}

/**
 * Weighted component output
 * Produced by applying season weights to normalized values
 */
export interface ComponentWeightedOutput {
  /** Unique component identifier */
  componentId: string;
  /** Component display name */
  name: string;
  /** Original raw value */
  raw: number;
  /** Normalized value (0-100) */
  normalized: number;
  /** Weight applied for this season (0-1) */
  weight: number;
  /** Weighted contribution (normalized * weight) */
  weighted: number;
  /** Unit of the raw measurement */
  unit: string;
  /** Human-readable explanation */
  notes: string;
}

// ============ Scoring Result Contract ============

/**
 * Complete scoring result with full explainability
 */
export interface ScoringResult {
  /** Weights version used */
  weightsVersion: string;
  /** Season profile used */
  season: SeasonId;
  /** Season display name */
  seasonName: string;
  /** Final aggregated score (0-100) */
  totalScore: number;
  /** Score grade (A-F) */
  grade: string;
  /** Individual component breakdowns */
  components: ComponentWeightedOutput[];
  /** Validation status */
  validation: ValidationResult;
  /** Timestamp of scoring */
  timestamp: string;
}

/**
 * Validation result for weights
 */
export interface ValidationResult {
  valid: boolean;
  weightSum: number;
  errors: string[];
}

// ============ Configuration Types ============

export type SeasonId = 'early' | 'rut' | 'late' | 'annual';

export type ComponentId = 
  | 'bedding_quality'
  | 'funnel_density'
  | 'corridor_coverage'
  | 'water_proximity'
  | 'edge_habitat'
  | 'terrain_diversity'
  | 'stand_site_count';

/**
 * Component definition from weights file
 */
export interface ComponentDefinition {
  id: ComponentId;
  name: string;
  description: string;
  unit: string;
  range: [number, number];
  invert?: boolean;
}

/**
 * Season profile from weights file
 */
export interface SeasonProfile {
  name: string;
  description: string;
  date_range: string;
  weights: Record<ComponentId, number>;
}

/**
 * Complete weights configuration
 */
export interface WeightsConfig {
  version: string;
  description: string;
  last_updated: string;
  components: Record<ComponentId, ComponentDefinition>;
  seasons: Record<SeasonId, SeasonProfile>;
}

// ============ Input Types ============

/**
 * Input for scoring aggregator
 */
export interface ScoringInput {
  /** Season to use for weights */
  season: SeasonId;
  /** Normalized component values */
  components: ComponentNormalizedOutput[];
}
