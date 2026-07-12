/**
 * Flow feature flags + real-data analysis caps.
 *
 * Piece 1 goal: kill synthetic flow by default. Every synthetic producer
 * (ridge spines, geometry-only indicator flow, legacy synthetic flow) is
 * gated behind `syntheticFlowEnabled()`, which defaults OFF.
 *
 * To re-enable synthetic flow (dev/debug only), set the environment variable
 *   NEXT_PUBLIC_ENABLE_SYNTHETIC_FLOW=1
 * Any other value (including unset) keeps synthetic flow OFF.
 */

/**
 * Whether synthetic flow generation is enabled. Defaults OFF.
 * Only the exact string '1' turns it on.
 */
export function syntheticFlowEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_SYNTHETIC_FLOW === '1';
}

/**
 * Hard cap on the acreage of real ridge/saddle spine data any single
 * whole-territory analysis will render flow for. Beyond this, the analysis
 * shows a clean "spin up a Hunt Zone here" empty-state instead of
 * whole-territory flow.
 */
export const MAX_ANALYSIS_ACRES = 300;

const SQUARE_METERS_PER_ACRE = 4046.8564224;

/**
 * Convert an acreage to the radius (in meters) of a circle with that area.
 * 300 acres -> ~621.7 m radius.
 */
export function acresToRadiusMeters(acres: number): number {
  const areaSqM = acres * SQUARE_METERS_PER_ACRE;
  return Math.sqrt(areaSqM / Math.PI);
}

/** Convert a square-meter area to acres. */
export function squareMetersToAcres(areaSqM: number): number {
  return areaSqM / SQUARE_METERS_PER_ACRE;
}
