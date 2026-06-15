/**
 * Shared lease-rate estimator — single source of truth used by both the
 * Hunt Report HTML builder and the listing-prefill pipeline.
 *
 * Returns a human-readable range string (e.g. "$12-18") representing the
 * estimated lease value per acre per year based on the property's
 * huntability score.
 */

export interface LeaseEstimateInput {
  /** Huntability / top-stand score (0-100). Null/undefined treated as 0. */
  topStandScore?: number | null;
}

/**
 * Estimate the lease value per acre per year.
 *
 * Tiers (matching the original report formula):
 *   ≥ 80  →  $18-25
 *   ≥ 60  →  $12-18
 *   ≥ 40  →  $8-12
 *   < 40  →  $4-8
 */
export function estimateLeasePerAcre(input: LeaseEstimateInput): string {
  const score = input.topStandScore ?? 0;
  if (score >= 80) return '$18-25';
  if (score >= 60) return '$12-18';
  if (score >= 40) return '$8-12';
  return '$4-8';
}
