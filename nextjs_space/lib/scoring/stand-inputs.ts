// ==============================
// Alignment v1 adapters (drop-in)
// ==============================

import type { StandInputs } from "@/lib/scoring/stand-alignment";

// ---- helpers ----
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Smallest angular difference between two bearings in degrees (0..180). */
export function smallestAngleDiffDeg(a: number, b: number) {
  const aa = ((a % 360) + 360) % 360;
  const bb = ((b % 360) + 360) % 360;
  let d = Math.abs(aa - bb);
  if (d > 180) d = 360 - d;
  return d;
}

/** Smoothstep for gentle ramps (woodsman calm). */
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Convert angular mismatch (deg) to wind_overlap (0..1).
 * - <=25°: very clean (~0.10)
 * - 25–60°: ramps to ~0.45
 * - 60–110°: ramps to ~0.80
 * - >110°: heavy (~0.90)
 */
export function windOverlapFromDelta(deltaDeg: number) {
  const d = clamp01(deltaDeg / 180) * 180;

  if (d <= 25) return 0.10;

  if (d <= 60) {
    const t = smoothstep(25, 60, d);
    return 0.10 + t * (0.45 - 0.10);
  }

  if (d <= 110) {
    const t = smoothstep(60, 110, d);
    return 0.45 + t * (0.80 - 0.45);
  }

  return 0.90;
}

/**
 * Movement score from corridor proximity distance (meters).
 * Stable across parcels: movement = exp(-dist / falloffM)
 * Typical falloff: 120–180m.
 */
export function movementFromCorridorDistanceMeters(distanceM?: number, falloffM = 150) {
  if (distanceM == null || !Number.isFinite(distanceM)) return 0.5; // conservative default
  const d = Math.max(0, distanceM);
  const m = Math.exp(-d / falloffM);
  return clamp01(m);
}

/** Intrusion from approach risk label. */
export function intrusionFromApproachRisk(risk?: string) {
  const r = (risk || "").toLowerCase();
  if (r.includes("low")) return 0.15;
  if (r.includes("med")) return 0.45;
  if (r.includes("high")) return 0.80;
  return 0.50;
}

/** Season fit (v1). */
export function seasonFitFromSeason(season?: string) {
  const s = (season || "").toLowerCase();
  if (s.includes("rut")) return 0.85;
  if (s.includes("early")) return 0.65;
  if (s.includes("late")) return 0.55;
  // pre-rut / unknown:
  return 0.70;
}

/**
 * Preferred wind bearing for a stand:
 * Use stand.preferredWindDeg if present.
 * Otherwise, if you store bestWindDirs like ["NW","N"], convert to bearing.
 * Otherwise return null and we fall back to neutral overlap (0.35).
 */
const CARDINAL_TO_DEG: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

export function preferredWindDegFromStand(stand: {
  preferredWindDeg?: number;
  bestWindDirs?: string[];
  windOk?: string[];
}): number | null {
  const pw = stand?.preferredWindDeg;
  if (typeof pw === "number" && Number.isFinite(pw)) return ((pw % 360) + 360) % 360;

  // Check bestWindDirs first, then windOk as fallback
  const dirs: string[] | undefined = stand?.bestWindDirs ?? stand?.windOk;
  if (Array.isArray(dirs) && dirs.length) {
    // Use the first best wind direction as the preferred bearing (v1 simple)
    const key = String(dirs[0]).toUpperCase().replace(/\s+/g, "");
    const deg = CARDINAL_TO_DEG[key];
    return typeof deg === "number" ? deg : null;
  }

  return null;
}

/** Convert cardinal wind direction to degrees */
export function windDirectionToDeg(dir: string): number {
  const key = String(dir).toUpperCase().replace(/\s+/g, "");
  return CARDINAL_TO_DEG[key] ?? 0;
}

/**
 * Build StandInputs for the Alignment Engine.
 * ctx.windDirDeg is required; others optional.
 */
export function buildStandInputs(
  stand: {
    distToCorridorMeters?: number;
    corridorDistanceM?: number;
    corridor_distance_m?: number;
    corridorDistM?: number;
    approachRisk?: string;
    approach_risk?: string;
    intrusion?: number;
    preferredWindDeg?: number;
    bestWindDirs?: string[];
    windOk?: string[];
  },
  ctx: {
    windDirDeg: number;
    season?: string;
    timeFit?: number;      // if you have AM/PM selector; else omit
    falloffM?: number;     // movement falloff in meters
  }
): StandInputs {
  // movement: corridor proximity
  const movement = movementFromCorridorDistanceMeters(
    stand?.distToCorridorMeters ?? stand?.corridorDistanceM ?? stand?.corridor_distance_m ?? stand?.corridorDistM,
    ctx.falloffM ?? 150
  );

  // intrusion: approach risk label or numeric if you already have it
  const intrusion =
    typeof stand?.intrusion === "number"
      ? clamp01(stand.intrusion)
      : intrusionFromApproachRisk(stand?.approachRisk ?? stand?.approach_risk);

  // wind_overlap: smooth based on delta to preferred wind; else neutral 0.35
  const preferred = preferredWindDegFromStand(stand);
  const wind_overlap =
    preferred == null
      ? 0.35
      : windOverlapFromDelta(smallestAngleDiffDeg(ctx.windDirDeg, preferred));

  const season_fit = seasonFitFromSeason(ctx.season);
  const time_fit = typeof ctx.timeFit === "number" ? clamp01(ctx.timeFit) : 0.5;

  return {
    wind_overlap,
    movement,
    intrusion,
    time_fit,
    season_fit,
  };
}
