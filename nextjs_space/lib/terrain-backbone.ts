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

// Lone-spine prominence bar (ft). A network of <= 1 qualifying line must carry at
// least this much measured DEM relief to count as a real backbone. Tunable via
// env; defaults to the calibrated 60 ft.
export const FLOW_LONE_SPINE_MIN_FT = Number(process.env.FLOW_LONE_SPINE_MIN_FT || 60);

// Per-line network floor (ft). To count toward the MULTI-LINE side of the gate,
// an individual traced ridge must carry at least this much measured DEM
// prominence. This closes the raw-count hole: flat-ag parcels that emit several
// weak artifact spines (each below this floor) no longer clear the network side
// just by line count. Calibrated (Jul 2026 dev probes) to sit in the gap
// between the strongest artifact network line seen (37 ft) and the weakest
// genuine network line kept (gasconade 41 ft). Tunable via env; default 40 ft.
export const NETWORK_LINE_MIN_FT = Number(process.env.FLOW_NETWORK_LINE_MIN_FT || 40);

/**
 * Decide whether a parcel has a real terrain backbone.
 *
 * @param networkLines     count of PROMINENCE-QUALIFIED traced ridge lines
 *                         (each >= NETWORK_LINE_MIN_FT), BEFORE any saddle
 *                         crossings are added. NOT the raw traced-line count:
 *                         weak sub-floor artifact spines are excluded so a flat
 *                         parcel can't clear the multi-line side on count alone.
 * @param maxProminenceFt  the strongest traced ridge's measured DEM prominence.
 * @param loneSpineMinFt   prominence bar for a lone spine (defaults to the
 *                         calibrated FLOW_LONE_SPINE_MIN_FT).
 */
export function assessBackbone(
  networkLines: number,
  maxProminenceFt: number,
  loneSpineMinFt: number = FLOW_LONE_SPINE_MIN_FT
): BackboneVerdict {
  // Starved unless EITHER (a) a genuine multi-line network exists (>= 2
  // prominence-qualified lines), OR (b) a single qualified spine clears the
  // lone-spine prominence bar. A parcel with only sub-floor artifact spines has
  // networkLines <= 1 and (being sub-floor) a maxProm below the bar -> starved.
  const starved = networkLines <= 1 && maxProminenceFt < loneSpineMinFt;
  if (starved) {
    return {
      hasRealBackbone: false,
      networkLines,
      maxProminenceFt,
      reason: `low-relief: ${networkLines} prominence-qualified spine (>=${NETWORK_LINE_MIN_FT}ft) below the ${loneSpineMinFt}ft lone-spine bar (maxProm=${Math.round(maxProminenceFt)}ft)`,
    };
  }
  return {
    hasRealBackbone: true,
    networkLines,
    maxProminenceFt,
    reason: `real backbone: ${networkLines} prominence-qualified line(s) (>=${NETWORK_LINE_MIN_FT}ft), maxProm=${Math.round(maxProminenceFt)}ft`,
  };
}
