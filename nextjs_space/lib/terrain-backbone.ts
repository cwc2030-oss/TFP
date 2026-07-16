/**
 * Shared "is there a real terrain backbone?" determination.
 *
 * This is the SINGLE source of truth consulted by BOTH readings of a parcel:
 *   - the flow engine (lib/terrain-flow-v3.ts) decides honest-empty vs. draw, and
 *   - the terrain story (lib/terrain-story.ts) decides low-relief vs. structured.
 *
 * The flow engine computes the verdict ONCE from the traced ridge network and
 * stamps it into the flow response metadata (`metadata.backbone`). The story
 * reads that same verdict rather than re-deriving relief from raw saddle counts.
 * One determination — both honor it — so the two readings can never contradict
 * (the flow can't render honest-empty while the story claims "high-convergence
 * structured terrain", which was the pre-v6.4 bug).
 *
 * Calibration (evidence-anchored, Jul 2026 dev probes):
 *   A parcel whose traced ridge network is a single lonely spine (<= 1 traced
 *   line) sitting BELOW the lone-spine prominence bar is a starved artifact, not
 *   real structure — historically it grew a saddle-crossing lattice ("wiggly
 *   rectangles following roads"). It now renders honest-empty flow AND reads an
 *   honest low-relief story.
 *   Genuine lone spines still clear the bar and keep their real reading:
 *     franklin 66 ft, osage 79 ft, warren 113 ft  -> real backbone (1 line).
 *   Any multi-line network (callaway 2, gasconade 3, Dietzfelbinger 7) clears
 *   the network side of the gate regardless of prominence.
 *   Starved artifacts caught: Putnam 49-53 ft single spine -> no backbone.
 *   The bar (60 ft) sits between the artifact ceiling (53) and the lowest
 *   genuine lone spine kept (franklin 66), biased low to avoid over-correction.
 */
import type { BackboneVerdict } from '@/types/terrain-flow';

export type { BackboneVerdict };

// Lone-spine prominence bar (ft). A network of <= 1 traced line must carry at
// least this much measured DEM relief to count as a real backbone. Tunable via
// env; defaults to the calibrated 60 ft.
export const FLOW_LONE_SPINE_MIN_FT = Number(process.env.FLOW_LONE_SPINE_MIN_FT || 60);

/**
 * Decide whether a parcel has a real terrain backbone.
 *
 * @param realLines        count of REAL traced ridge lines (primary + secondary),
 *                         BEFORE any saddle crossings are added.
 * @param maxProminenceFt  the strongest traced ridge's measured DEM prominence.
 * @param loneSpineMinFt   prominence bar for a lone spine (defaults to the
 *                         calibrated FLOW_LONE_SPINE_MIN_FT).
 */
export function assessBackbone(
  realLines: number,
  maxProminenceFt: number,
  loneSpineMinFt: number = FLOW_LONE_SPINE_MIN_FT
): BackboneVerdict {
  const starved = realLines <= 1 && maxProminenceFt < loneSpineMinFt;
  if (starved) {
    return {
      hasRealBackbone: false,
      realLines,
      maxProminenceFt,
      reason: `low-relief: ${realLines} traced spine below the ${loneSpineMinFt}ft lone-spine bar (maxProm=${Math.round(maxProminenceFt)}ft)`,
    };
  }
  return {
    hasRealBackbone: true,
    realLines,
    maxProminenceFt,
    reason: `real backbone: ${realLines} traced line(s), maxProm=${Math.round(maxProminenceFt)}ft`,
  };
}
