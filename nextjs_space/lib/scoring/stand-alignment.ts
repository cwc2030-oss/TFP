// ==========================================
// WHITETAIL ALIGNMENT ENGINE v1.0 (LOCKED)
// Deterministic • Absolute • Parcel-Gated Exceptional
// ==========================================

export type StandInputs = {
  wind_overlap: number;   // 0 (clean) → 1 (heavy overlap)
  movement: number;       // 0 (weak) → 1 (strong)
  intrusion: number;      // 0 (quiet) → 1 (high disturbance)
  time_fit: number;       // 0 → 1
  season_fit: number;     // 0 → 1
};

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
  };

  const wind_fit = clamp(1 - safeInput.wind_overlap);
  const intrusion_fit = clamp(1 - safeInput.intrusion);

  // Weighted deterministic alignment
  // v3.8: Reduced movement (corridor proximity) from 0.30→0.25
  //        Increased intrusion (access safety) from 0.20→0.25
  //        Prevents corridor triple-dipping from dominating stand selection
  const raw =
    0.35 * wind_fit +
    0.25 * clamp(safeInput.movement) +
    0.25 * intrusion_fit +
    0.10 * clamp(safeInput.time_fit) +
    0.05 * clamp(safeInput.season_fit);

  // Slight generosity curve
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
