// ==========================================
// WHITETAIL ALIGNMENT ENGINE v1.1
// Deterministic • Absolute • Parcel-Gated Exceptional
// ------------------------------------------
// v1.1 change log (see lib/scoring/weights/stand-alignment-v1_1.yaml):
//   • Added `inside_corner` as a weighted structural factor (0.20).
//   • Rebalanced: wind 0.35 (king, unchanged) · inside_corner 0.20 (new)
//                 movement 0.25→0.17 · intrusion 0.25→0.20
//                 time 0.10→0.05 · season 0.05→0.03. Sum = 1.00.
//   • The 0.20 pulled mostly from movement on purpose — an inside corner
//     IS a movement signal, so shifting weight there avoids inflating net
//     structural weight (v3.8 warned about structural triple-dipping).
//   • ADAPTIVE RENORMALIZATION GUARD: a parcel with NO inside corners
//     (all-timber, no ag edges) is NOT penalized — the 0.20 is redistributed
//     proportionally across the remaining 5 factors so timber parcels are
//     scored purely on their own merits. See computeStandScore().
// ==========================================

export type StandInputs = {
  wind_overlap: number;   // 0 (clean) → 1 (heavy overlap)
  movement: number;       // 0 (weak) → 1 (strong)
  intrusion: number;      // 0 (quiet) → 1 (high disturbance)
  time_fit: number;       // 0 → 1
  season_fit: number;     // 0 → 1
  // v1.1 concave-corner factor (0 far → 1 sitting in a sharp, deer-used corner).
  //   • number  → the parcel HAS inside corners; factor applies at this value.
  //   • null / undefined → the parcel has NO inside corners; the engine
  //     renormalizes the remaining factors instead of scoring a 0 here.
  inside_corner?: number | null;
};

// v1.1 stand-alignment weights (must sum to 1.00 with inside_corner present).
export const STAND_ALIGNMENT_WEIGHTS_V1_1 = {
  wind: 0.35,
  inside_corner: 0.20,
  movement: 0.17,
  intrusion: 0.20,
  time: 0.05,
  season: 0.03,
} as const;

export type StandScore = {
  score: number;          // 0–100
  raw: number;            // 0–1
  label: "Deep Moss" | "Weathered Oak" | "Field Stone" | "Open Ground";
};

// Default values for missing features
export const DEFAULT_INPUTS: StandInputs = {
  movement: 0.5,
  wind_overlap: 0.35,
  intrusion: 0.5,
  time_fit: 0.5,
  season_fit: 0.5,
  inside_corner: null,   // default: no corner factor → engine renormalizes
};

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

export function computeStandScore(input: Partial<StandInputs>): StandScore {
  // Apply defaults for missing features
  const safeInput: StandInputs = {
    wind_overlap: input.wind_overlap ?? DEFAULT_INPUTS.wind_overlap,
    movement: input.movement ?? DEFAULT_INPUTS.movement,
    intrusion: input.intrusion ?? DEFAULT_INPUTS.intrusion,
    time_fit: input.time_fit ?? DEFAULT_INPUTS.time_fit,
    season_fit: input.season_fit ?? DEFAULT_INPUTS.season_fit,
    // Preserve the tri-state: number applies the factor, null/undefined
    // triggers the renormalization guard. Do NOT coalesce to a default number.
    inside_corner: input.inside_corner ?? null,
  };

  const wind_fit = clamp(1 - safeInput.wind_overlap);
  const intrusion_fit = clamp(1 - safeInput.intrusion);
  const movement_fit = clamp(safeInput.movement);
  const time_fit = clamp(safeInput.time_fit);
  const season_fit = clamp(safeInput.season_fit);

  const W = STAND_ALIGNMENT_WEIGHTS_V1_1;

  // Does this stand's parcel actually have inside corners? A numeric value
  // (including 0 for "corner exists but this stand is far") means yes; a
  // null/undefined means the parcel has none.
  const cornerApplies =
    safeInput.inside_corner !== null && safeInput.inside_corner !== undefined;

  // Weighted deterministic alignment (v1.1)
  // v3.8: movement 0.30→0.25, intrusion 0.20→0.25 to stop corridor triple-dipping.
  // v1.1: movement 0.25→0.17, intrusion 0.25→0.20, time 0.10→0.05, season 0.05→0.03
  //        to make room for inside_corner (0.20) without ballooning structure.
  let raw: number;
  if (cornerApplies) {
    const inside_corner_fit = clamp(safeInput.inside_corner as number);
    raw =
      W.wind * wind_fit +
      W.inside_corner * inside_corner_fit +
      W.movement * movement_fit +
      W.intrusion * intrusion_fit +
      W.time * time_fit +
      W.season * season_fit;
  } else {
    // ADAPTIVE RENORMALIZATION GUARD (non-negotiable):
    // No inside corners on this parcel → redistribute the 0.20 inside_corner
    // weight proportionally across the other 5 factors (which sum to 0.80),
    // so an all-timber parcel is judged on its own merits, never penalized.
    const remaining =
      W.wind + W.movement + W.intrusion + W.time + W.season; // 0.80
    raw =
      (W.wind / remaining) * wind_fit +
      (W.movement / remaining) * movement_fit +
      (W.intrusion / remaining) * intrusion_fit +
      (W.time / remaining) * time_fit +
      (W.season / remaining) * season_fit;
  }

  // Slight generosity curve (preserved from v1.0)
  const adjusted = Math.pow(clamp(raw), 0.85);

  const score = Math.round(adjusted * 100);

  let label: StandScore["label"];
  if (score >= 85) label = "Deep Moss";
  else if (score >= 70) label = "Weathered Oak";
  else if (score >= 55) label = "Field Stone";
  else label = "Open Ground";

  return { score, raw: adjusted, label };
}

export function computeParcelStrength(scores: number[]): number {
  if (!scores.length) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

export function qualifiesExceptional(
  top: StandInputs & { score: number },
  secondScore: number,
  parcelStrength: number
): boolean {
  return (
    top.score >= 92 &&
    top.score - secondScore >= 5 &&
    top.wind_overlap <= 0.05 &&
    top.intrusion <= 0.25 &&
    top.movement >= 0.75 &&
    parcelStrength >= 70
  );
}

// Wind Stability Rule
// Only recompute alignment if wind direction changes > 10°
// Prevents jitter from gusts
export function shouldRecomputeWind(prevDir: number, newDir: number): boolean {
  return Math.abs(prevDir - newDir) > 10;
}

/**
 * Score multiple stands and determine if top qualifies for Exceptional
 */
export function scoreStandsWithExceptional(
  stands: Array<Partial<StandInputs>>
): {
  scores: StandScore[];
  parcelStrength: number;
  exceptionalIndex: number | null;
} {
  const scores = stands.map((s) => computeStandScore(s));
  const scoreValues = scores.map((s) => s.score);
  const parcelStrength = computeParcelStrength(scoreValues);

  // Sort to find top two
  const sorted = [...scoreValues].sort((a, b) => b - a);
  const topScore = sorted[0] ?? 0;
  const secondScore = sorted[1] ?? 0;
  const topIndex = scoreValues.indexOf(topScore);

  // Check if top qualifies for Exceptional
  let exceptionalIndex: number | null = null;
  if (topIndex >= 0) {
    const topInputs = {
      ...DEFAULT_INPUTS,
      ...stands[topIndex],
      score: topScore,
    };
    if (qualifiesExceptional(topInputs, secondScore, parcelStrength)) {
      exceptionalIndex = topIndex;
    }
  }

  return { scores, parcelStrength, exceptionalIndex };
}
