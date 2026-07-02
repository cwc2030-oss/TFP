/**
 * County Deer Flow aggregation.
 *
 * Rolls per-parcel Terrain Brain flow signals (from TerrainAnalysisCache)
 * up to a county-level Deer Flow Index + letter grade. Used by the
 * compute/seed script and the public flow-by-area view.
 *
 * OPSEC: nothing in here emits lat/lng or parcel identity. County is the
 * finest grain that leaves this module.
 */
import { gradeFromScore } from '@/lib/listings';

export interface ParcelFlowSignal {
  topStandScore: number | null | undefined;
  funnelCount: number | null | undefined;
  beddingAcres: number | null | undefined;
  corridorCount: number | null | undefined;
  interceptCount: number | null | undefined;
}

/**
 * Per-parcel Deer Flow Index (0-100). Mirrors the weighting used for
 * published listings in lib/listings.ts#computeFlowIndex so a county score
 * is directly comparable to an individual listing's flow index.
 *
 *   0.50 terrain (top intercept/stand score)
 *   0.20 corridors (capped at 5)
 *   0.20 funnels   (capped at 4)
 *   0.10 intercepts (capped at 3)
 */
export function parcelFlowIndex(s: ParcelFlowSignal): number {
  const terrain = clamp01((s.topStandScore ?? 0) / 100);
  const corridors = clamp01((s.corridorCount ?? 0) / 5);
  const funnels = clamp01((s.funnelCount ?? 0) / 4);
  const intercepts = clamp01((s.interceptCount ?? 0) / 3);
  return Math.round(
    100 * (0.5 * terrain + 0.2 * corridors + 0.2 * funnels + 0.1 * intercepts),
  );
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Extract the flow signals we need from a parsed TerrainAnalysisCache.data
 * object. Tolerant of shape drift: corridor/convergence collections may be
 * arrays or GeoJSON FeatureCollections.
 */
export function signalFromCacheData(d: any): ParcelFlowSignal {
  const summary = d?.summary ?? {};
  const tc = d?.tieredCorridorData ?? {};
  const tf = d?.terrainFlowData ?? {};
  return {
    topStandScore: summary.topStandScore,
    funnelCount: summary.funnelCount,
    beddingAcres: summary.totalBeddingAcres,
    corridorCount: featureLen(tc.corridors_primary) + featureLen(tc.corridors_possible),
    interceptCount: featureLen(tf.convergence_zones),
  };
}

function featureLen(x: any): number {
  if (!x) return 0;
  if (Array.isArray(x)) return x.length;
  if (Array.isArray(x.features)) return x.features.length;
  return 0;
}

/**
 * Normalize a raw county string to a clean display name.
 *   "johnson"        -> "Johnson"
 *   "st-francois"    -> "St. Francois"
 *   "ste-genevieve"  -> "Ste. Genevieve"
 *   "mcdonald"       -> "McDonald"
 *   "ST. LOUIS"      -> "St. Louis"
 * Splits on spaces AND hyphens (source data often arrives slugified).
 */
export function normalizeCounty(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\bcounty\b/i, '').trim();
  if (!cleaned) return null;
  const tokens = cleaned.split(/[\s\-]+/).filter(Boolean);
  if (!tokens.length) return null;
  return tokens.map((t) => titleToken(t.toLowerCase())).join(' ');
}

function cap(w: string): string {
  return w.length ? w[0].toUpperCase() + w.slice(1) : w;
}

function titleToken(t: string): string {
  // Strip any stray trailing period so "st." and "st" collapse together.
  const bare = t.replace(/\.$/, '');
  if (bare === 'st') return 'St.';
  if (bare === 'ste') return 'Ste.';
  // Mc / Mac Scottish prefixes: "mcdonald" -> "McDonald".
  if (bare.startsWith('mc') && bare.length > 2) return 'Mc' + cap(bare.slice(2));
  // O' names: "o'brien" -> "O'Brien".
  if (bare.startsWith("o'") && bare.length > 2) return "O'" + cap(bare.slice(2));
  return cap(bare);
}

export function flowGrade(avgFlowIndex: number): string {
  return gradeFromScore(avgFlowIndex);
}

/** Tailwind color band for a flow grade badge. */
export function flowGradeColor(grade: string): string {
  const g = grade.charAt(0);
  if (grade.startsWith('A')) return 'text-emerald-700 bg-emerald-100 border-emerald-300';
  if (grade.startsWith('B')) return 'text-amber-700 bg-amber-100 border-amber-300';
  if (g === 'C') return 'text-orange-700 bg-orange-100 border-orange-300';
  return 'text-gray-600 bg-gray-100 border-gray-300';
}

export interface CountyAccumulator {
  state: string;
  county: string;
  flowSum: number;
  funnelSum: number;
  bedSum: number;
  topSum: number;
  count: number;
  highFlow: number;
}

/**
 * Shrinkage strength (pseudo-parcels). A county's score is pulled toward the
 * global per-parcel mean as if it also had K parcels sitting exactly at the
 * mean. With K=8, a 1-parcel county lands near the mean (untrustworthy), while
 * a 20+ parcel county keeps most of its earned score. This is what stops a
 * single-parcel county from topping the leaderboard, without flattening the
 * counties that genuinely have a lot of analyzed ground behind them.
 */
export const SHRINKAGE_K = 8;

/** Counties backed by fewer than this many analyzed parcels get a "limited data" flag. */
export const LIMITED_DATA_FLOOR = 5;

/**
 * Finalize a county row.
 * @param a       accumulated per-parcel sums for this county
 * @param priorMean  global per-parcel mean flow index (the shrinkage target)
 */
export function finalizeCounty(a: CountyAccumulator, priorMean: number) {
  const avgFlowIndex = a.count ? Math.round(a.flowSum / a.count) : 0;
  // Empirical-Bayes shrinkage toward the global mean.
  const adjustedFlowIndex = Math.round(
    (a.flowSum + SHRINKAGE_K * priorMean) / (a.count + SHRINKAGE_K),
  );
  return {
    state: a.state,
    county: a.county,
    parcelCount: a.count,
    avgFlowIndex,
    adjustedFlowIndex,
    limitedData: a.count < LIMITED_DATA_FLOOR,
    // Grade + ranking follow the trustworthy adjusted score, not the raw mean.
    grade: flowGrade(adjustedFlowIndex),
    avgFunnelCount: a.count ? round1(a.funnelSum / a.count) : 0,
    avgBedAcres: a.count ? round1(a.bedSum / a.count) : 0,
    avgTopStand: a.count ? round1(a.topSum / a.count) : 0,
    highFlowCount: a.highFlow,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/* --------------------------------------------------------------------------
 * Display-layer tier labels (Green / Blue / Black) for the county pages.
 * These map the numeric adjustedFlowIndex (0–100) onto the same visual
 * language as the map's flow tiering. They DO NOT touch the ranking engine,
 * gradeFromScore, or adjustedFlowIndex — purely a presentation helper.
 * Cutoffs are provisional and easy to tweak.
 * ------------------------------------------------------------------------ */
export type FlowBand = 'green' | 'blue' | 'black';

export interface FlowTier {
  tier: string;   // one-word label
  band: FlowBand; // color family
  diamonds: number; // black-diamond count (ski metaphor); 0 for blue/green
  min: number;    // lower bound of the band (for filter floors)
}

export function flowTier(index: number): FlowTier {
  if (index >= 90) return { tier: 'Elite', band: 'black', diamonds: 3, min: 90 };
  if (index >= 80) return { tier: 'Premium', band: 'black', diamonds: 2, min: 80 };
  if (index >= 70) return { tier: 'Prime', band: 'black', diamonds: 1, min: 70 };
  if (index >= 60) return { tier: 'Strong', band: 'blue', diamonds: 0, min: 60 };
  if (index >= 50) return { tier: 'Solid', band: 'blue', diamonds: 0, min: 50 };
  if (index >= 40) return { tier: 'Developing', band: 'green', diamonds: 0, min: 40 };
  return { tier: 'Marginal', band: 'green', diamonds: 0, min: 0 };
}

// Palette borrowed from the map's FLOW_TIER_COLORS so the two views agree.
export const FLOW_BAND_STYLE: Record<FlowBand, { bg: string; fg: string; ring: string }> = {
  green: { bg: '#2D6A4F', fg: '#ffffff', ring: '#B7D9C6' },
  blue:  { bg: '#3B6FA0', fg: '#ffffff', ring: '#B9CFE4' },
  black: { bg: '#1A1A1A', fg: '#F5E6B8', ring: '#8b6b1f' },
};
