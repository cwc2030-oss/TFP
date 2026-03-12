/**
 * Broker-Ready Scoring Engine v1.0
 * 
 * Computes a 0-1 broker score to identify parcels suitable for broker/landowner demos.
 * Uses terrain-derived metrics only (no vegetation/wind/access inputs).
 */

export type BrokerClass = 'broker_ready' | 'potential_demo' | 'not_broker_ready';

export interface BrokerScoreComponents {
  flowStructureQuality: number;      // 0-1: coherent, believable corridors
  convergenceStrength: number;       // 0-1: pinch points / overlap zones
  terrainFeatureSupport: number;     // 0-1: DEM-derived terrain backing
  demConfidence: number;             // 0-1: analysis mode confidence
  acreageAppropriateness: number;    // 0-1: target market fit (80-200 ac ideal)
}

export interface BrokerScoreResult {
  brokerScore: number;               // 0.00-1.00 final weighted score
  brokerClass: BrokerClass;          // Classification label
  components: BrokerScoreComponents; // Individual subscores
  explanation: string;               // Human-readable summary
}

// ============ COMPONENT SCORING FUNCTIONS ============

/**
 * Flow Structure Quality (30% weight)
 * Measures whether flow lines form coherent, believable corridors.
 * 
 * Inputs:
 * - meanFlowLikelihood: average likelihood across all flow segments
 * - strongFlowRatio: proportion of segments with likelihood >= 0.7
 * - continuityScore: connectedness vs fragmentation
 */
export function computeFlowStructureQuality(
  flowSegments: Array<{ likelihood: number; isPrimary?: boolean }>,
  convergenceZones?: number
): number {
  if (!flowSegments || flowSegments.length === 0) {
    return 0.1; // Minimal score for no flows
  }

  // Mean flow likelihood
  const likelihoods = flowSegments.map(s => s.likelihood);
  const meanFlowLikelihood = likelihoods.reduce((a, b) => a + b, 0) / likelihoods.length;

  // Strong flow ratio (>= 0.7 threshold)
  const strongFlows = flowSegments.filter(s => s.likelihood >= 0.7).length;
  const strongFlowRatio = strongFlows / flowSegments.length;

  // Continuity score - reward having primary flows, penalize too many weak segments
  const primaryFlows = flowSegments.filter(s => s.isPrimary).length;
  const weakFlows = flowSegments.filter(s => s.likelihood < 0.5).length;
  const weakRatio = weakFlows / flowSegments.length;
  
  // Continuity: high if we have primaries and not too many weak fragments
  let continuityScore = 0.5; // baseline
  if (primaryFlows >= 3) continuityScore += 0.25;
  else if (primaryFlows >= 1) continuityScore += 0.15;
  if (weakRatio < 0.3) continuityScore += 0.25;
  else if (weakRatio < 0.5) continuityScore += 0.1;
  continuityScore = Math.min(1, continuityScore);

  // Bonus for convergence zones indicating structure
  const convergenceBonus = convergenceZones ? Math.min(0.1, convergenceZones * 0.03) : 0;

  const quality = (
    0.40 * meanFlowLikelihood +
    0.40 * strongFlowRatio +
    0.20 * continuityScore +
    convergenceBonus
  );

  return Math.min(1, Math.max(0, quality));
}

/**
 * Convergence Strength (20% weight)
 * Measures presence and intensity of terrain pinch points.
 * 
 * Inputs:
 * - convergenceZoneCount: number of detected convergence/overlap zones
 * - maxOverlapIntensity: highest overlap score in any zone (0-1)
 */
export function computeConvergenceStrength(
  convergenceZoneCount: number,
  maxOverlapIntensity?: number
): number {
  // Base score from zone count
  let baseScore: number;
  if (convergenceZoneCount === 0) {
    baseScore = 0.15;
  } else if (convergenceZoneCount === 1) {
    baseScore = 0.45;
  } else if (convergenceZoneCount === 2) {
    baseScore = 0.65;
  } else if (convergenceZoneCount >= 3) {
    baseScore = 0.85 + Math.min(0.15, (convergenceZoneCount - 3) * 0.05);
  } else {
    baseScore = 0.15;
  }

  // Intensity bonus
  const intensityBonus = maxOverlapIntensity ? maxOverlapIntensity * 0.15 : 0;

  return Math.min(1, Math.max(0, baseScore + intensityBonus));
}

/**
 * Terrain Feature Support (20% weight)
 * Measures whether flows are backed by actual terrain structure.
 * 
 * Inputs (from DEM analysis):
 * - ridgeSupport: 0-1 proximity/alignment with detected ridges
 * - saddleSupport: 0-1 proximity to detected saddles
 * - benchSupport: 0-1 presence of bench features
 */
export function computeTerrainFeatureSupport(
  ridgeSupport: number,
  saddleSupport: number,
  benchSupport: number,
  hasDEMData: boolean
): number {
  if (!hasDEMData) {
    // Degrade gracefully without DEM
    return 0.35;
  }

  // Simple mean of supports
  const mean = (ridgeSupport + saddleSupport + benchSupport) / 3;
  
  // Bonus if multiple features detected
  const featureCount = [
    ridgeSupport > 0.3 ? 1 : 0,
    saddleSupport > 0.3 ? 1 : 0,
    benchSupport > 0.3 ? 1 : 0
  ].reduce((a, b) => a + b, 0);
  
  const diversityBonus = featureCount >= 2 ? 0.1 : 0;

  return Math.min(1, Math.max(0, mean + diversityBonus));
}

/**
 * DEM Confidence (15% weight)
 * Reflects confidence based on underlying analysis mode.
 */
export function computeDEMConfidence(demMode: string): number {
  const modeMap: Record<string, number> = {
    'dem-derived': 1.00,
    'dem_derived': 1.00,
    'terrain-driven proxy': 0.60,
    'terrain_driven_proxy': 0.60,
    'proxy': 0.60,
    'synthetic fallback': 0.30,
    'synthetic_fallback': 0.30,
    'synthetic': 0.30,
    'error': 0.00,
    'failed': 0.00,
    'unknown': 0.40
  };

  const normalized = demMode.toLowerCase().replace(/[\s-]/g, '_');
  return modeMap[normalized] ?? modeMap[demMode.toLowerCase()] ?? 0.40;
}

/**
 * Acreage Appropriateness (15% weight)
 * Favors parcel sizes relevant to hunting/broker market.
 */
export function computeAcreageAppropriateness(acreage: number | null | undefined): number {
  if (acreage == null || acreage <= 0) {
    return 0.50; // Neutral fallback
  }

  // Ideal: 80-200 acres
  if (acreage >= 80 && acreage <= 200) {
    return 1.00;
  }
  // Good: 40-80 or 200-300 acres
  if ((acreage >= 40 && acreage < 80) || (acreage > 200 && acreage <= 300)) {
    return 0.70;
  }
  // Acceptable: 20-40 or 300-500 acres
  if ((acreage >= 20 && acreage < 40) || (acreage > 300 && acreage <= 500)) {
    return 0.55;
  }
  // Less ideal: very small or very large
  return 0.40;
}

// ============ MAIN SCORING FUNCTION ============

export interface BrokerScoreInput {
  // Flow data
  flowSegments?: Array<{ likelihood: number; isPrimary?: boolean }>;
  
  // Convergence data
  convergenceZoneCount?: number;
  maxOverlapIntensity?: number;
  
  // Terrain feature support (0-1 each)
  ridgeSupport?: number;
  saddleSupport?: number;
  benchSupport?: number;
  hasDEMData?: boolean;
  
  // Analysis mode
  demMode: string;
  
  // Parcel info
  acreage?: number | null;
}

/**
 * Compute the full broker score with all components.
 */
export function computeBrokerScore(input: BrokerScoreInput): BrokerScoreResult {
  // Compute individual components
  const flowStructureQuality = computeFlowStructureQuality(
    input.flowSegments || [],
    input.convergenceZoneCount
  );

  const convergenceStrength = computeConvergenceStrength(
    input.convergenceZoneCount || 0,
    input.maxOverlapIntensity
  );

  const terrainFeatureSupport = computeTerrainFeatureSupport(
    input.ridgeSupport ?? 0,
    input.saddleSupport ?? 0,
    input.benchSupport ?? 0,
    input.hasDEMData ?? false
  );

  const demConfidence = computeDEMConfidence(input.demMode);

  const acreageAppropriateness = computeAcreageAppropriateness(input.acreage);

  // Weighted combination
  const brokerScore = Math.min(1, Math.max(0,
    0.30 * flowStructureQuality +
    0.20 * convergenceStrength +
    0.20 * terrainFeatureSupport +
    0.15 * demConfidence +
    0.15 * acreageAppropriateness
  ));

  // Classification
  let brokerClass: BrokerClass;
  if (brokerScore >= 0.75) {
    brokerClass = 'broker_ready';
  } else if (brokerScore >= 0.55) {
    brokerClass = 'potential_demo';
  } else {
    brokerClass = 'not_broker_ready';
  }

  // Generate explanation
  const explanation = generateExplanation(
    brokerScore,
    brokerClass,
    { flowStructureQuality, convergenceStrength, terrainFeatureSupport, demConfidence, acreageAppropriateness }
  );

  return {
    brokerScore: Math.round(brokerScore * 100) / 100,
    brokerClass,
    components: {
      flowStructureQuality: Math.round(flowStructureQuality * 100) / 100,
      convergenceStrength: Math.round(convergenceStrength * 100) / 100,
      terrainFeatureSupport: Math.round(terrainFeatureSupport * 100) / 100,
      demConfidence: Math.round(demConfidence * 100) / 100,
      acreageAppropriateness: Math.round(acreageAppropriateness * 100) / 100
    },
    explanation
  };
}

function generateExplanation(
  score: number,
  brokerClass: BrokerClass,
  components: BrokerScoreComponents
): string {
  const parts: string[] = [];

  // Lead with classification
  if (brokerClass === 'broker_ready') {
    parts.push('Strong demo candidate.');
  } else if (brokerClass === 'potential_demo') {
    parts.push('Shows promise for demos.');
  } else {
    parts.push('Not ideal for demos.');
  }

  // Highlight strengths
  const strengths: string[] = [];
  if (components.flowStructureQuality >= 0.7) strengths.push('coherent flows');
  if (components.convergenceStrength >= 0.7) strengths.push('strong pinch points');
  if (components.terrainFeatureSupport >= 0.7) strengths.push('good terrain backing');
  if (components.demConfidence >= 0.9) strengths.push('DEM-derived');
  if (components.acreageAppropriateness >= 0.9) strengths.push('ideal size');

  if (strengths.length > 0) {
    parts.push(`Strengths: ${strengths.join(', ')}.`);
  }

  // Highlight weaknesses
  const weaknesses: string[] = [];
  if (components.flowStructureQuality < 0.4) weaknesses.push('weak flow structure');
  if (components.convergenceStrength < 0.3) weaknesses.push('few convergence points');
  if (components.terrainFeatureSupport < 0.4) weaknesses.push('limited terrain features');
  if (components.demConfidence < 0.5) weaknesses.push('low DEM confidence');
  if (components.acreageAppropriateness < 0.5) weaknesses.push('non-ideal acreage');

  if (weaknesses.length > 0) {
    parts.push(`Weaknesses: ${weaknesses.join(', ')}.`);
  }

  return parts.join(' ');
}

// ============ HELPER: EXTRACT METRICS FROM TERRAIN FLOW DATA ============

/**
 * Extract broker scoring inputs from typical terrain flow response data.
 * This bridges the gap between raw API responses and the scoring function.
 */
export function extractBrokerMetrics(terrainFlowData: {
  flows?: Array<{ segments?: Array<{ likelihood?: number }>; flowType?: string }>;
  convergenceZones?: Array<{ intensity?: number }>;
  demMode?: string;
  analysisMode?: string;
  ridgeCount?: number;
  saddleCount?: number;
  benchCount?: number;
  // Alternative structure
  primaryFlows?: Array<{ likelihood?: number }>;
  secondaryFlows?: Array<{ likelihood?: number }>;
  opportunityZones?: Array<{ score?: number }>;
}): Partial<BrokerScoreInput> {
  const result: Partial<BrokerScoreInput> = {};

  // Extract flow segments
  const flowSegments: Array<{ likelihood: number; isPrimary: boolean }> = [];
  
  if (terrainFlowData.flows) {
    terrainFlowData.flows.forEach(flow => {
      const isPrimary = flow.flowType === 'primary';
      if (flow.segments) {
        flow.segments.forEach(seg => {
          flowSegments.push({
            likelihood: seg.likelihood ?? 0.5,
            isPrimary
          });
        });
      }
    });
  }
  
  // Alternative: primaryFlows / secondaryFlows arrays
  if (terrainFlowData.primaryFlows) {
    terrainFlowData.primaryFlows.forEach(f => {
      flowSegments.push({ likelihood: f.likelihood ?? 0.7, isPrimary: true });
    });
  }
  if (terrainFlowData.secondaryFlows) {
    terrainFlowData.secondaryFlows.forEach(f => {
      flowSegments.push({ likelihood: f.likelihood ?? 0.5, isPrimary: false });
    });
  }

  if (flowSegments.length > 0) {
    result.flowSegments = flowSegments;
  }

  // Extract convergence data
  if (terrainFlowData.convergenceZones) {
    result.convergenceZoneCount = terrainFlowData.convergenceZones.length;
    const intensities = terrainFlowData.convergenceZones
      .map(z => z.intensity ?? 0)
      .filter(i => i > 0);
    if (intensities.length > 0) {
      result.maxOverlapIntensity = Math.max(...intensities);
    }
  }
  
  // Alternative: opportunityZones
  if (terrainFlowData.opportunityZones && !result.convergenceZoneCount) {
    result.convergenceZoneCount = terrainFlowData.opportunityZones.length;
    const scores = terrainFlowData.opportunityZones
      .map(z => z.score ?? 0)
      .filter(s => s > 0);
    if (scores.length > 0) {
      result.maxOverlapIntensity = Math.max(...scores);
    }
  }

  // Extract DEM mode
  result.demMode = terrainFlowData.demMode || terrainFlowData.analysisMode || 'unknown';

  // Extract terrain feature support (normalize counts to 0-1)
  if (terrainFlowData.ridgeCount !== undefined) {
    result.ridgeSupport = Math.min(1, terrainFlowData.ridgeCount / 5);
  }
  if (terrainFlowData.saddleCount !== undefined) {
    result.saddleSupport = Math.min(1, terrainFlowData.saddleCount / 3);
  }
  if (terrainFlowData.benchCount !== undefined) {
    result.benchSupport = Math.min(1, terrainFlowData.benchCount / 4);
  }

  // Determine if we have DEM data
  result.hasDEMData = (
    result.demMode?.toLowerCase().includes('dem') ||
    result.ridgeSupport !== undefined ||
    result.saddleSupport !== undefined
  );

  return result;
}

// ============ CLASSIFICATION HELPERS ============

export function getBrokerClassLabel(brokerClass: BrokerClass): string {
  switch (brokerClass) {
    case 'broker_ready': return 'Broker Ready';
    case 'potential_demo': return 'Potential Demo';
    case 'not_broker_ready': return 'Not Broker Ready';
    default: return 'Unknown';
  }
}

export function getBrokerClassShort(brokerClass: BrokerClass): 'YES' | 'MAYBE' | 'NO' {
  switch (brokerClass) {
    case 'broker_ready': return 'YES';
    case 'potential_demo': return 'MAYBE';
    case 'not_broker_ready': return 'NO';
    default: return 'NO';
  }
}

export function getBrokerClassColor(brokerClass: BrokerClass): {
  bg: string;
  text: string;
  border: string;
} {
  switch (brokerClass) {
    case 'broker_ready':
      return { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/40' };
    case 'potential_demo':
      return { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/40' };
    case 'not_broker_ready':
      return { bg: 'bg-slate-500/20', text: 'text-slate-400', border: 'border-slate-500/40' };
    default:
      return { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/40' };
  }
}
