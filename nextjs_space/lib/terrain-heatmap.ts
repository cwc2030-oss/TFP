/**
 * Terrain-Driven Heat Map Builder v3
 *
 * TERRAIN-FIRST architecture: heat comes only from terrain structure.
 * Convergence is DEMOTED to a local amplifier / tie-breaker — not a heat source.
 *
 *   terrain_pressure =
 *     0.40 × bench_probability   +
 *     0.30 × saddle_probability  +
 *     0.30 × ridge_structure
 *
 *   Then: if convergence is near a terrain hotspot, boost by up to +15%.
 *   Convergence alone generates ZERO heat.
 *
 * convergenceMode controls A/B testing:
 *   'off'   → Version A: pure terrain, no convergence at all
 *   'light' → Version B: terrain-first + light convergence refinement (+15% max)
 */

import type { SeasonProfile } from '@/types/terrain';

// ============ CONVERGENCE MODE ============
export type ConvergenceMode = 'off' | 'light';

// ============ TERRAIN-FIRST WEIGHTS ============
// No convergence/draw weight — redistro across bench/saddle/ridge
const W_BENCH  = 0.40;  // was 0.35 — promoted (primary terrain structure)
const W_SADDLE = 0.30;  // was 0.25 — promoted (key deer funnels)
const W_RIDGE  = 0.30;  // was 0.20 — promoted (spine of terrain story)

// Convergence amplifier cap (only in 'light' mode)
const CONVERGENCE_AMP_MAX = 0.15; // max +15% boost on existing terrain heat
const CONVERGENCE_AMP_RADIUS_M = 120; // how close convergence must be to boost

// ============ SEASON WEIGHT PROFILES ============
const SEASON_WEIGHTS: Record<SeasonProfile, SeasonWeightProfile> = {
  early: {
    label: 'Early Season (Sept-Oct)',
    bench: 1.3,          // Food-adjacent bedding is key
    saddle: 0.8,         // Less travel through saddles
    ridge: 0.9,          // Moderate ridge use
  },
  rut: {
    label: 'Rut (Nov)',
    bench: 0.8,          // Bucks leave benches
    saddle: 1.4,         // Saddle crossings are king
    ridge: 1.2,          // Ridgeline travel increases
  },
  late: {
    label: 'Late Season (Dec-Jan)',
    bench: 1.2,          // Return to thermal benches
    saddle: 0.9,         // Moderate saddle use
    ridge: 0.8,          // Less ridge travel
  },
};

interface SeasonWeightProfile {
  label: string;
  bench: number;
  saddle: number;
  ridge: number;
}

export interface RidgeSpineInput {
  ridges_primary: GeoJSON.FeatureCollection;
  ridges_secondary: GeoJSON.FeatureCollection;
  saddle_nodes: GeoJSON.FeatureCollection;
  isSynthetic?: boolean;
}

export interface HeatMapInput {
  /** Modal analysis: bedding polygons → bench_probability proxy */
  beddingPolygons?: GeoJSON.FeatureCollection;
  /** Modal analysis: funnels → used ONLY as convergence amplifier, NOT primary heat */
  funnels?: GeoJSON.FeatureCollection;
  /** Ridge spine data → ridge_structure + saddle_probability */
  ridgeSpineData?: RidgeSpineInput | null;
  /** Parcel boundary (for proximity calculations) */
  parcelCoords?: number[][];
  /** Season profile */
  season: SeasonProfile;
  /** Convergence mode: 'off' = pure terrain, 'light' = terrain + convergence amplifier */
  convergenceMode?: ConvergenceMode;
}

// ============ INFLUENCE RADII (meters) ============
const BENCH_INFLUENCE_M  = 75;
const SADDLE_INFLUENCE_M = 120;
const RIDGE_INFLUENCE_M  = 60;

/**
 * Build terrain-driven heat map features.
 * Returns a FeatureCollection of Point features with `score` property (0-1).
 *
 * Heat is ONLY placed where terrain structure exists.
 * Convergence does NOT generate heat — it only amplifies nearby terrain points.
 */
export function buildTerrainHeatMap(input: HeatMapInput): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const sw = SEASON_WEIGHTS[input.season] || SEASON_WEIGHTS.rut;
  const convMode = input.convergenceMode ?? 'light';

  // ====== BENCH_PROBABILITY (0.40) ← bedding polygons ======
  if (input.beddingPolygons?.features?.length) {
    for (const f of input.beddingPolygons.features) {
      const props = f.properties || {};
      const confidence = props.confidence || 0.6;
      const rawBench = Math.min(1, confidence * 1.3);
      const score = rawBench * W_BENCH * sw.bench;

      const centroid = getPolygonCentroid(f.geometry);
      if (centroid) {
        features.push(makeHeatPoint(centroid, score, 'bench'));
      }
      const pts = sampleGeometryPoints(f.geometry, 8);
      for (const pt of pts) {
        features.push(makeHeatPoint(pt, score * 0.8, 'bench'));
      }
    }
  }

  // ====== SADDLE_PROBABILITY (0.30) ← saddle_nodes ======
  const saddleNodes = input.ridgeSpineData?.saddle_nodes?.features || [];
  if (saddleNodes.length > 0) {
    for (const f of saddleNodes) {
      const props = f.properties || {};
      const dropFt = props.ridgeDropFt || 15;
      const rawSaddle = Math.min(1, dropFt / 30);
      const score = rawSaddle * W_SADDLE * sw.saddle;

      if (f.geometry?.type === 'Point') {
        const coord = f.geometry.coordinates as [number, number];
        features.push(makeHeatPoint(coord, score, 'saddle'));
        // Tight halo
        const haloOffsetDeg = (SADDLE_INFLUENCE_M * 0.5) / 111000;
        const offsets: [number, number][] = [
          [haloOffsetDeg, 0], [-haloOffsetDeg, 0],
          [0, haloOffsetDeg], [0, -haloOffsetDeg],
        ];
        for (const [dx, dy] of offsets) {
          features.push(makeHeatPoint(
            [coord[0] + dx, coord[1] + dy],
            score * 0.55,
            'saddle_halo'
          ));
        }
      }
    }
  }

  // ====== RIDGE_STRUCTURE (0.30) ← ridge spines ======
  const useSyntheticRidges = input.ridgeSpineData?.isSynthetic ?? true;
  const ridgePrimary = input.ridgeSpineData?.ridges_primary?.features || [];
  const ridgeSecondary = input.ridgeSpineData?.ridges_secondary?.features || [];
  const allRidges = [...ridgePrimary, ...ridgeSecondary];

  if (allRidges.length > 0) {
    for (const f of allRidges) {
      const props = f.properties || {};
      const isPrimary = ridgePrimary.includes(f);
      const prominenceFt = props.prominenceFt || props.prominence_ft || 20;
      const rawRidge = Math.min(1, prominenceFt / 45) * (isPrimary ? 1.0 : 0.7);
      const syntheticPenalty = useSyntheticRidges ? 0.5 : 1.0;
      const score = rawRidge * syntheticPenalty * W_RIDGE * sw.ridge;

      const coords = (f.geometry as GeoJSON.LineString)?.coordinates || [];
      if (coords.length >= 2) {
        const step = Math.max(1, Math.floor(coords.length / 10));
        for (let i = 0; i < coords.length; i += step) {
          features.push(makeHeatPoint(
            coords[i] as [number, number],
            score * (i === 0 || i >= coords.length - step ? 0.7 : 1.0),
            'ridge'
          ));
        }
      }
    }
  }

  // ====== NO DRAW/CONVERGENCE HEAT POINTS ======
  // Funnels/convergence do NOT generate heat. They only amplify below.

  // ====== TERRAIN INTERSECTION BONUSES ======
  addIntersectionBonuses(features, sw);

  // ====== CONVERGENCE AMPLIFIER (light mode only) ======
  // For each existing terrain heat point, if convergence is nearby, boost score.
  // This is the ONLY way convergence affects the map.
  if (convMode === 'light' && input.funnels?.features?.length) {
    applyConvergenceAmplifier(features, input.funnels);
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Apply convergence as a LOCAL AMPLIFIER on existing terrain heat points.
 * For each heat point, check proximity to funnels/convergence features.
 * If close, boost score by up to CONVERGENCE_AMP_MAX (15%).
 * This never creates new heat — only strengthens what terrain already placed.
 */
function applyConvergenceAmplifier(
  features: GeoJSON.Feature[],
  funnels: GeoJSON.FeatureCollection
) {
  // Build a list of convergence reference points from funnels
  const convPoints: [number, number][] = [];
  for (const f of funnels.features) {
    if (f.geometry.type === 'Point') {
      convPoints.push(f.geometry.coordinates as [number, number]);
    } else if (f.geometry.type === 'LineString') {
      const coords = (f.geometry as GeoJSON.LineString).coordinates;
      // Use draw head (last point) and midpoint
      if (coords.length >= 2) {
        convPoints.push(coords[coords.length - 1] as [number, number]);
        convPoints.push(coords[Math.floor(coords.length / 2)] as [number, number]);
      }
    } else if (f.geometry.type === 'Polygon') {
      const centroid = getPolygonCentroid(f.geometry);
      if (centroid) convPoints.push(centroid);
    }
  }

  if (convPoints.length === 0) return;

  const ampRadiusDeg = CONVERGENCE_AMP_RADIUS_M / 111000;

  for (const feat of features) {
    if (feat.geometry.type !== 'Point' || !feat.properties?.score) continue;
    const coord = feat.geometry.coordinates as [number, number];
    const currentScore = feat.properties.score as number;

    // Find nearest convergence point
    let minDist = Infinity;
    for (const cp of convPoints) {
      const d = coordDist(coord, cp);
      if (d < minDist) minDist = d;
    }

    if (minDist < ampRadiusDeg) {
      // Proximity factor: 1.0 at center, 0.0 at edge
      const proximity = 1 - minDist / ampRadiusDeg;
      // Boost: up to CONVERGENCE_AMP_MAX of the current score
      const boost = currentScore * CONVERGENCE_AMP_MAX * proximity;
      feat.properties.score = Math.min(1, currentScore + boost);
      feat.properties.convergenceBoost = boost;
    }
  }
}

/**
 * Get the active season weights (for UI display / debugging)
 */
export function getSeasonWeights(season: SeasonProfile): SeasonWeightProfile {
  return SEASON_WEIGHTS[season] || SEASON_WEIGHTS.rut;
}

// ============ STAND-SITE RESCORING ============

/**
 * Re-score opportunity zones using terrain-first formula.
 * Convergence is only a small tie-breaker bonus, not a main driver.
 * Called client-side after all data sources are available.
 * Returns up to 3 zones, sorted best-to-worst.
 */
export function rescoreStandSites(
  opportunityZones: GeoJSON.FeatureCollection | undefined,
  input: HeatMapInput
): GeoJSON.FeatureCollection {
  const emptyFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  const zones = opportunityZones?.features || [];
  if (zones.length === 0) return emptyFC;

  const sw = SEASON_WEIGHTS[input.season] || SEASON_WEIGHTS.rut;
  const convMode = input.convergenceMode ?? 'light';

  const scored = zones.map(f => {
    if (f.geometry.type !== 'Point') return { feature: f, score: 0 };
    const coord = f.geometry.coordinates as [number, number];

    // Primary terrain scores (100% of base score)
    const benchProx = proximityToFeatures(coord, input.beddingPolygons, 140);
    const saddleProx = proximityToFeatures(coord, input.ridgeSpineData?.saddle_nodes, 200);
    const allRidges: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        ...(input.ridgeSpineData?.ridges_primary?.features || []),
        ...(input.ridgeSpineData?.ridges_secondary?.features || []),
      ],
    };
    const isSynthetic = input.ridgeSpineData?.isSynthetic ?? true;
    const ridgeStruct = proximityToFeatures(coord, allRidges, 140) * (isSynthetic ? 0.5 : 1.0);

    // Terrain-only base score
    const terrainScore =
      W_BENCH * benchProx * sw.bench +
      W_SADDLE * saddleProx * sw.saddle +
      W_RIDGE * ridgeStruct * sw.ridge;

    // Convergence as tie-breaker only (light mode: up to +10% of terrain score)
    let convBonus = 0;
    if (convMode === 'light') {
      const drawConv = proximityToFeatures(coord, input.funnels, 170);
      convBonus = terrainScore * 0.10 * drawConv; // max +10% boost, scaled by proximity
    }

    const rawScore = terrainScore + convBonus;

    const updatedFeature: GeoJSON.Feature = {
      ...f,
      properties: {
        ...f.properties,
        score: Math.min(1, rawScore * 1.5 + 0.1),
        benchBonus: benchProx * W_BENCH,
        saddleBonus: saddleProx * W_SADDLE,
        ridgeBonus: ridgeStruct * W_RIDGE,
        convergenceBoost: convBonus,
      },
    };

    return { feature: updatedFeature, score: rawScore };
  });

  scored.sort((a, b) => b.score - a.score);

  return {
    type: 'FeatureCollection',
    features: scored.slice(0, 3).map(s => s.feature),
  };
}

/** Proximity score (0-1) from a coordinate to the nearest feature in a collection. */
function proximityToFeatures(
  coord: [number, number],
  fc: GeoJSON.FeatureCollection | undefined | null,
  radiusM: number
): number {
  if (!fc?.features?.length) return 0;
  const radiusDeg = radiusM / 111000;
  let minDist = Infinity;
  for (const f of fc.features) {
    if (f.geometry.type === 'Point') {
      const d = coordDist(coord, f.geometry.coordinates as [number, number]);
      if (d < minDist) minDist = d;
    } else if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
      const c = getPolygonCentroid(f.geometry);
      if (c) {
        const d = coordDist(coord, c);
        if (d < minDist) minDist = d;
      }
    } else if (f.geometry.type === 'LineString') {
      for (const pt of (f.geometry as GeoJSON.LineString).coordinates) {
        const d = coordDist(coord, [pt[0], pt[1]]);
        if (d < minDist) minDist = d;
      }
    }
  }
  return minDist < radiusDeg ? Math.max(0, 1 - minDist / radiusDeg) : 0;
}

// ============ INTERSECTION BONUSES (terrain-only) ============

/**
 * Where multiple TERRAIN structure types overlap spatially,
 * the combined signal is stronger than any single layer.
 * NOTE: No draw/convergence intersections — only bench × saddle × ridge.
 */
function addIntersectionBonuses(
  features: GeoJSON.Feature[],
  sw: SeasonWeightProfile
) {
  const byType: Record<string, [number, number][]> = {};
  for (const f of features) {
    const src = (f.properties?.source || '') as string;
    const baseType = src.replace(/_halo|_edge|_head|_mid|_mouth/, '');
    if (f.geometry.type === 'Point') {
      const coord = f.geometry.coordinates as [number, number];
      if (!byType[baseType]) byType[baseType] = [];
      byType[baseType].push(coord);
    }
  }

  const PROXIMITY_DEG = 100 / 111000;

  const saddlePts = byType['saddle'] || [];
  const benchPts = byType['bench'] || [];
  const ridgePts = byType['ridge'] || [];
  // NOTE: no drawPts — convergence is not in the intersection model

  // Saddle × Bench (highest value intersection)
  for (const sp of saddlePts) {
    for (const bp of benchPts) {
      if (coordDist(sp, bp) < PROXIMITY_DEG) {
        const midPt: [number, number] = [(sp[0] + bp[0]) / 2, (sp[1] + bp[1]) / 2];
        features.push(makeHeatPoint(midPt, 0.20 * sw.saddle, 'intersection_saddle_bench'));
      }
    }
  }

  // Saddle × Ridge
  for (const sp of saddlePts) {
    for (const rp of ridgePts) {
      if (coordDist(sp, rp) < PROXIMITY_DEG) {
        const midPt: [number, number] = [(sp[0] + rp[0]) / 2, (sp[1] + rp[1]) / 2];
        features.push(makeHeatPoint(midPt, 0.16 * sw.saddle, 'intersection_saddle_ridge'));
      }
    }
  }

  // Ridge × Bench
  for (const rp of ridgePts) {
    for (const bp of benchPts) {
      if (coordDist(rp, bp) < PROXIMITY_DEG) {
        const midPt: [number, number] = [(rp[0] + bp[0]) / 2, (rp[1] + bp[1]) / 2];
        features.push(makeHeatPoint(midPt, 0.14 * sw.ridge, 'intersection_ridge_bench'));
      }
    }
  }
}

// ============ HELPERS ============

function coordDist(a: [number, number], b: [number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

function makeHeatPoint(
  coord: [number, number] | number[],
  score: number,
  source: string
): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    properties: {
      score: Math.max(0, Math.min(1, score)),
      source,
    },
    geometry: {
      type: 'Point',
      coordinates: [coord[0], coord[1]],
    },
  };
}

function getPolygonCentroid(geometry: GeoJSON.Geometry): [number, number] | null {
  let coords: number[][] = [];
  if (geometry.type === 'Polygon') {
    coords = (geometry as GeoJSON.Polygon).coordinates[0] || [];
  } else if (geometry.type === 'MultiPolygon') {
    coords = ((geometry as GeoJSON.MultiPolygon).coordinates[0] || [])[0] || [];
  } else {
    return null;
  }
  if (coords.length === 0) return null;

  let sumX = 0, sumY = 0;
  for (const c of coords) {
    sumX += c[0];
    sumY += c[1];
  }
  return [sumX / coords.length, sumY / coords.length];
}

function sampleGeometryPoints(geometry: GeoJSON.Geometry, count: number): [number, number][] {
  let coords: number[][] = [];
  if (geometry.type === 'Polygon') {
    coords = (geometry as GeoJSON.Polygon).coordinates[0] || [];
  } else if (geometry.type === 'LineString') {
    coords = (geometry as GeoJSON.LineString).coordinates;
  } else if (geometry.type === 'MultiPolygon') {
    coords = ((geometry as GeoJSON.MultiPolygon).coordinates[0] || [])[0] || [];
  } else {
    return [];
  }

  if (coords.length <= count) {
    return coords.map(c => [c[0], c[1]] as [number, number]);
  }

  const step = Math.floor(coords.length / count);
  const result: [number, number][] = [];
  for (let i = 0; i < coords.length && result.length < count; i += step) {
    result.push([coords[i][0], coords[i][1]]);
  }
  return result;
}
