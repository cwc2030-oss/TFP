/**
 * flow-tiering.ts — Green/Blue/Black flow tier classification
 *
 * Ski-resort-inspired tier system mapping movement likelihood
 * to visual confidence tiers:
 *   Green (≥0.66): High-confidence movement corridors (green runs)
 *   Blue  (0.33–0.66): Moderate-confidence feeders (blue runs)
 *   Black (<0.33): Low-confidence / speculative paths (black diamonds)
 *
 * The upstream pipeline emits features with `likelihood` scores (0-1).
 * This module reclassifies them into display tiers for the unified
 * tfp-flow-tiers Mapbox source.
 */

export type DisplayFlowTier = 'green' | 'blue' | 'black';

export const FLOW_TIER_THRESHOLDS = {
  green: 0.66,   // ≥0.66 likelihood
  blue: 0.33,    // 0.33–0.66
  // black: <0.33
} as const;

/** Tier colors — chosen for satellite imagery readability */
export const FLOW_TIER_COLORS = {
  green: '#2D6A4F',       // Deep forest green
  greenGlow: '#40916C',   // Lighter green glow
  blue: '#3B6FA0',        // Steel blue
  blueGlow: '#5A8FC0',    // Lighter blue glow
  black: '#1A1A1A',       // Near-black (existing)
  blackGlow: '#3A3A3A',   // Dark gray glow
} as const;

/** Width multipliers relative to base flowPrimaryWidth from scale-adaptive */
export const FLOW_TIER_WIDTH_MULT = {
  green: 1.0,    // Full width
  blue: 0.75,    // 75%
  black: 0.55,   // 55%
} as const;

/**
 * Classify a likelihood score into a display tier.
 */
export function classifyFlowTier(likelihood: number): DisplayFlowTier {
  if (likelihood >= FLOW_TIER_THRESHOLDS.green) return 'green';
  if (likelihood >= FLOW_TIER_THRESHOLDS.blue) return 'blue';
  return 'black';
}

/**
 * Merge primary and secondary flow FeatureCollections into a single
 * unified FeatureCollection with `flowTier` classification.
 *
 * Each feature receives:
 *   - flowTier: 'green' | 'blue' | 'black'
 *   - originalTier: preserved 'primary' | 'secondary' for diagnostics
 *
 * Output is sorted bottom→top: black first, green last (for rendering
 * order within the same Mapbox source).
 */
export function mergeAndClassifyFlows(
  flowPrimary: GeoJSON.FeatureCollection | null | undefined,
  flowSecondary: GeoJSON.FeatureCollection | null | undefined,
): GeoJSON.FeatureCollection {
  const allFeatures = [
    ...(flowPrimary?.features || []),
    ...(flowSecondary?.features || []),
  ];

  const classified = allFeatures.map(feature => ({
    ...feature,
    properties: {
      ...feature.properties,
      flowTier: classifyFlowTier(feature.properties?.likelihood ?? 0.5),
      originalTier: feature.properties?.tier,
    },
  }));

  // Sort: black (bottom) → blue → green (top) for z-order within source
  const tierOrder: Record<DisplayFlowTier, number> = { black: 0, blue: 1, green: 2 };
  classified.sort((a, b) =>
    (tierOrder[(a.properties?.flowTier as DisplayFlowTier) || 'black'] || 0) -
    (tierOrder[(b.properties?.flowTier as DisplayFlowTier) || 'black'] || 0)
  );

  return {
    type: 'FeatureCollection',
    features: classified,
  };
}

/**
 * Count features per tier for badge display.
 */
export function countByTier(
  fc: GeoJSON.FeatureCollection | null | undefined
): { green: number; blue: number; black: number; total: number } {
  const counts = { green: 0, blue: 0, black: 0, total: 0 };
  for (const f of fc?.features || []) {
    const tier = f.properties?.flowTier as DisplayFlowTier;
    if (tier in counts) (counts as any)[tier]++;
    counts.total++;
  }
  return counts;
}
