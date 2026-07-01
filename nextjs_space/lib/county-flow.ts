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

/** Normalize a raw county string (e.g. "johnson", "ST. LOUIS") to Title Case. */
export function normalizeCounty(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/\bcounty\b/i, '')
    .trim()
    .toLowerCase();
  if (!cleaned) return null;
  return cleaned
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
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

export function finalizeCounty(a: CountyAccumulator) {
  const avgFlowIndex = a.count ? Math.round(a.flowSum / a.count) : 0;
  return {
    state: a.state,
    county: a.county,
    parcelCount: a.count,
    avgFlowIndex,
    grade: flowGrade(avgFlowIndex),
    avgFunnelCount: a.count ? round1(a.funnelSum / a.count) : 0,
    avgBedAcres: a.count ? round1(a.bedSum / a.count) : 0,
    avgTopStand: a.count ? round1(a.topSum / a.count) : 0,
    highFlowCount: a.highFlow,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
