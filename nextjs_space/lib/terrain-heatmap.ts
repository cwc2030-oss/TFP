/**
 * Terrain-Driven Heat Map Builder v2
 *
 * Four DEM-structure layers detected from slope, curvature, and TPI:
 *
 *   terrain_pressure =
 *     0.35 × bench_probability   +
 *     0.25 × saddle_probability  +
 *     0.20 × ridge_structure     +
 *     0.20 × draw_convergence
 *
 * Season weights act as multipliers on the raw layer scores.
 * No synthetic grid fill — heat is ONLY where terrain structure exists.
 */

import type { SeasonProfile } from '@/types/terrain';

// ============ COMPONENT WEIGHTS (user-specified) ============
const W_BENCH  = 0.35;
const W_SADDLE = 0.25;
const W_RIDGE  = 0.20;
const W_DRAW   = 0.20;

// ============ SEASON WEIGHT PROFILES ============
const SEASON_WEIGHTS: Record<SeasonProfile, SeasonWeightProfile> = {
  early: {
    label: 'Early Season (Sept-Oct)',
    bench: 1.3,          // Food-adjacent bedding is key
    saddle: 0.8,         // Less travel through saddles
    ridge: 0.9,          // Moderate ridge use
    draw: 0.7,           // Draws less critical early
  },
  rut: {
    label: 'Rut (Nov)',
    bench: 0.8,          // Bucks leave benches
    saddle: 1.4,         // Saddle crossings are king
    ridge: 1.2,          // Ridgeline travel increases
    draw: 1.1,           // Draw heads become funnels
  },
  late: {
    label: 'Late Season (Dec-Jan)',
    bench: 1.2,          // Return to thermal benches
    saddle: 0.9,         // Moderate saddle use
    ridge: 0.8,          // Less ridge travel
    draw: 0.6,           // Draws less critical late
  },
};

interface SeasonWeightProfile {
  label: string;
  bench: number;
  saddle: number;
  ridge: number;
  draw: number;
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
  /** Modal analysis: funnels → draw_convergence proxy */
  funnels?: GeoJSON.FeatureCollection;
  /** Ridge spine data → ridge_structure + saddle_probability */
  ridgeSpineData?: RidgeSpineInput | null;
  /** Parcel boundary (for proximity calculations) */
  parcelCoords?: number[][];
  /** Season profile */
  season: SeasonProfile;
}

// ============ INFLUENCE RADII (meters) ============
const BENCH_INFLUENCE_M  = 120;  // Bench heat spreads ~120m
const SADDLE_INFLUENCE_M = 200;  // Saddle draws from further
const RIDGE_INFLUENCE_M  = 100;  // Ridge heat is tighter
const DRAW_INFLUENCE_M   = 150;  // Draw head influence

/**
 * Build terrain-driven heat map features.
 * Returns a FeatureCollection of Point features with `score` property (0-1).
 *
 * Heat is ONLY placed where terrain structure exists — no synthetic grid.
 * Each source feature generates a cluster of heat points (centroid + samples)
 * weighted by the 4-component formula.
 */
export function buildTerrainHeatMap(input: HeatMapInput): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const sw = SEASON_WEIGHTS[input.season] || SEASON_WEIGHTS.rut;

  // ====== BENCH_PROBABILITY (0.35) ← bedding polygons ======
  if (input.beddingPolygons?.features?.length) {
    for (const f of input.beddingPolygons.features) {
      const props = f.properties || {};
      const confidence = props.confidence || 0.6;
      // Raw bench probability from bedding confidence
      const rawBench = Math.min(1, confidence * 1.1);
      const score = rawBench * W_BENCH * sw.bench;

      const centroid = getPolygonCentroid(f.geometry);
      if (centroid) {
        features.push(makeHeatPoint(centroid, score, 'bench'));
      }
      // Spread heat across bedding area
      const pts = sampleGeometryPoints(f.geometry, 5);
      for (const pt of pts) {
        features.push(makeHeatPoint(pt, score * 0.8, 'bench'));
      }
    }
  }

  // ====== SADDLE_PROBABILITY (0.25) ← saddle_nodes ======
  const saddleNodes = input.ridgeSpineData?.saddle_nodes?.features || [];
  if (saddleNodes.length > 0) {
    for (const f of saddleNodes) {
      const props = f.properties || {};
      // Saddle quality: deeper drop = better funnel
      const dropFt = props.ridgeDropFt || 15;
      const rawSaddle = Math.min(1, dropFt / 40); // 40ft drop = max
      const score = rawSaddle * W_SADDLE * sw.saddle;

      if (f.geometry?.type === 'Point') {
        const coord = f.geometry.coordinates as [number, number];
        features.push(makeHeatPoint(coord, score, 'saddle'));
        // Halo: 4 surrounding points at ~half influence
        const haloOffsetDeg = SADDLE_INFLUENCE_M / 111000; // rough m→deg
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

  // ====== RIDGE_STRUCTURE (0.20) ← ridge spines ======
  const useSyntheticRidges = input.ridgeSpineData?.isSynthetic ?? true;
  const ridgePrimary = input.ridgeSpineData?.ridges_primary?.features || [];
  const ridgeSecondary = input.ridgeSpineData?.ridges_secondary?.features || [];
  const allRidges = [...ridgePrimary, ...ridgeSecondary];

  if (allRidges.length > 0) {
    for (const f of allRidges) {
      const props = f.properties || {};
      const isPrimary = ridgePrimary.includes(f);
      // Primary ridges score higher than secondary
      const prominenceFt = props.prominenceFt || props.prominence_ft || 20;
      const rawRidge = Math.min(1, prominenceFt / 60) * (isPrimary ? 1.0 : 0.7);
      // Down-weight synthetic ridges (backbone fallback)
      const syntheticPenalty = useSyntheticRidges ? 0.5 : 1.0;
      const score = rawRidge * syntheticPenalty * W_RIDGE * sw.ridge;

      // Sample points along the ridge line
      const coords = (f.geometry as GeoJSON.LineString)?.coordinates || [];
      if (coords.length >= 2) {
        const step = Math.max(1, Math.floor(coords.length / 6));
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

  // ====== DRAW_CONVERGENCE (0.20) ← funnels (draw/convergence) ======
  if (input.funnels?.features?.length) {
    for (const f of input.funnels.features) {
      const props = f.properties || {};
      const corridorScore = props.corridorScore || props.score || 0.6;
      const rawDraw = Math.min(1, corridorScore * 1.1);
      const score = rawDraw * W_DRAW * sw.draw;

      if (f.geometry.type === 'Point') {
        features.push(makeHeatPoint(
          f.geometry.coordinates as [number, number],
          score,
          'draw'
        ));
      } else if (f.geometry.type === 'LineString') {
        const coords = (f.geometry as GeoJSON.LineString).coordinates;
        // Focus heat at the convergence end (last point = draw head)
        if (coords.length >= 2) {
          // Draw head = strongest
          features.push(makeHeatPoint(
            coords[coords.length - 1] as [number, number],
            score,
            'draw_head'
          ));
          // Mid-draw
          const mid = Math.floor(coords.length / 2);
          features.push(makeHeatPoint(
            coords[mid] as [number, number],
            score * 0.65,
            'draw_mid'
          ));
          // Mouth = weakest
          features.push(makeHeatPoint(
            coords[0] as [number, number],
            score * 0.4,
            'draw_mouth'
          ));
        }
      } else if (f.geometry.type === 'Polygon') {
        const centroid = getPolygonCentroid(f.geometry);
        if (centroid) {
          features.push(makeHeatPoint(centroid, score, 'draw'));
        }
        const pts = sampleGeometryPoints(f.geometry, 3);
        for (const pt of pts) {
          features.push(makeHeatPoint(pt, score * 0.6, 'draw_edge'));
        }
      }
    }
  }

  // ====== INTERSECTION BONUSES ======
  // Where two structure types overlap within proximity, boost heat
  addIntersectionBonuses(features, sw);

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Get the active season weights (for UI display / debugging)
 */
export function getSeasonWeights(season: SeasonProfile): SeasonWeightProfile {
  return SEASON_WEIGHTS[season] || SEASON_WEIGHTS.rut;
}

// ============ STAND-SITE RESCORING ============

/**
 * Re-score opportunity zones using the 4-component terrain formula.
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

  const scored = zones.map(f => {
    if (f.geometry.type !== 'Point') return { feature: f, score: 0 };
    const coord = f.geometry.coordinates as [number, number];

    // Bench proximity
    const benchProx = proximityToFeatures(coord, input.beddingPolygons, 200);
    // Saddle proximity
    const saddleProx = proximityToFeatures(coord, input.ridgeSpineData?.saddle_nodes, 300);
    // Ridge structure
    const allRidges: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        ...(input.ridgeSpineData?.ridges_primary?.features || []),
        ...(input.ridgeSpineData?.ridges_secondary?.features || []),
      ],
    };
    const isSynthetic = input.ridgeSpineData?.isSynthetic ?? true;
    const ridgeStruct = proximityToFeatures(coord, allRidges, 200) * (isSynthetic ? 0.5 : 1.0);
    // Draw convergence
    const drawConv = proximityToFeatures(coord, input.funnels, 250);

    const rawScore =
      W_BENCH * benchProx * sw.bench +
      W_SADDLE * saddleProx * sw.saddle +
      W_RIDGE * ridgeStruct * sw.ridge +
      W_DRAW * drawConv * sw.draw;

    // Update feature properties with component scores
    const updatedFeature: GeoJSON.Feature = {
      ...f,
      properties: {
        ...f.properties,
        score: Math.min(1, rawScore * 1.5 + 0.1),
        benchBonus: benchProx * W_BENCH,
        saddleBonus: saddleProx * W_SADDLE,
        ridgeBonus: ridgeStruct * W_RIDGE,
        drawBonus: drawConv * W_DRAW,
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
  const radiusDeg = radiusM / 111000; // rough m→deg
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

// ============ INTERSECTION BONUSES ============

/**
 * Where multiple terrain structure types overlap spatially,
 * the combined signal is stronger than any single layer.
 * E.g. a saddle at a ridge junction is extremely high-value.
 */
function addIntersectionBonuses(
  features: GeoJSON.Feature[],
  sw: SeasonWeightProfile
) {
  // Collect point locations by source type
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

  const PROXIMITY_DEG = 150 / 111000; // ~150m in degrees

  // Saddle near bench = high-value intersection
  const saddlePts = byType['saddle'] || [];
  const benchPts = byType['bench'] || [];
  const ridgePts = byType['ridge'] || [];
  const drawPts = byType['draw'] || [];

  for (const sp of saddlePts) {
    for (const bp of benchPts) {
      if (coordDist(sp, bp) < PROXIMITY_DEG) {
        const midPt: [number, number] = [(sp[0] + bp[0]) / 2, (sp[1] + bp[1]) / 2];
        features.push(makeHeatPoint(midPt, 0.18 * sw.saddle, 'intersection_saddle_bench'));
      }
    }
    for (const dp of drawPts) {
      if (coordDist(sp, dp) < PROXIMITY_DEG) {
        const midPt: [number, number] = [(sp[0] + dp[0]) / 2, (sp[1] + dp[1]) / 2];
        features.push(makeHeatPoint(midPt, 0.15 * sw.saddle, 'intersection_saddle_draw'));
      }
    }
  }

  for (const rp of ridgePts) {
    for (const bp of benchPts) {
      if (coordDist(rp, bp) < PROXIMITY_DEG) {
        const midPt: [number, number] = [(rp[0] + bp[0]) / 2, (rp[1] + bp[1]) / 2];
        features.push(makeHeatPoint(midPt, 0.12 * sw.ridge, 'intersection_ridge_bench'));
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
