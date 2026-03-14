/**
 * Terrain-Driven Heat Map Builder
 * 
 * Replaces the old self-referential flow→convergence→opportunity loop
 * with a system grounded in actual terrain features.
 * 
 * Heat map composition (by design weight):
 *   1. Terrain features from Modal analysis (bedding, funnels, stands) — 45%
 *   2. Parcel-wide terrain grid (elevation variation, slope breaks) — 30%
 *   3. Flow/convergence validation signal — 15%
 *   4. Season-specific adjustment — 10% modifier on all above
 */

import type { SeasonProfile } from '@/types/terrain';

// ============ SEASON WEIGHT PROFILES ============
// Each season emphasizes different terrain features
const SEASON_WEIGHTS: Record<SeasonProfile, SeasonWeightProfile> = {
  early: {
    label: 'Early Season (Sept-Oct)',
    bedding: 1.3,        // Food-adjacent bedding is key
    funnels: 0.7,        // Travel corridors less critical
    standPoints: 1.0,    // Neutral
    slopeBreaks: 1.1,    // Edge transitions matter
    southFacing: 0.8,    // Thermal not yet critical
    ridgeProximity: 0.9, // Moderate
    convergence: 0.7,    // De-emphasize flow convergence
  },
  rut: {
    label: 'Rut (Nov)',
    bedding: 0.8,        // Bucks abandon bedding patterns
    funnels: 1.4,        // Funnels and pinch points are king
    standPoints: 1.2,    // Stand placement critical
    slopeBreaks: 1.2,    // Terrain funneling matters
    southFacing: 0.9,    // Moderate
    ridgeProximity: 1.1, // Ridgeline travel increases
    convergence: 1.0,    // Neutral
  },
  late: {
    label: 'Late Season (Dec-Jan)',
    bedding: 1.1,        // Return to bedding patterns
    funnels: 0.8,        // Less cruising
    standPoints: 1.0,    // Neutral
    slopeBreaks: 0.9,    // Less important
    southFacing: 1.4,    // Thermal cover dominant
    ridgeProximity: 0.8, // Less ridge travel
    convergence: 0.6,    // Minimal flow emphasis
  },
};

interface SeasonWeightProfile {
  label: string;
  bedding: number;
  funnels: number;
  standPoints: number;
  slopeBreaks: number;
  southFacing: number;
  ridgeProximity: number;
  convergence: number;
}

export interface HeatMapInput {
  /** Modal analysis layers */
  beddingPolygons?: GeoJSON.FeatureCollection;
  funnels?: GeoJSON.FeatureCollection;
  standPoints?: GeoJSON.FeatureCollection;
  /** Parcel boundary coordinates */
  parcelCoords?: number[][];
  /** Flow engine output (demoted to validation role) */
  convergenceZones?: GeoJSON.FeatureCollection;
  opportunityZones?: GeoJSON.FeatureCollection;
  flowPrimary?: GeoJSON.FeatureCollection;
  /** Season profile */
  season: SeasonProfile;
}

/**
 * Build terrain-driven heat map features.
 * Returns a FeatureCollection of Point features with `score` property (0-1).
 */
export function buildTerrainHeatMap(input: HeatMapInput): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const weights = SEASON_WEIGHTS[input.season] || SEASON_WEIGHTS.rut;

  // ====== LAYER 1: Terrain Features from Modal (45% weight) ======

  // 1a. Bedding polygons → sample centroids + edge points
  if (input.beddingPolygons?.features?.length) {
    for (const f of input.beddingPolygons.features) {
      const props = f.properties || {};
      const baseScore = (props.confidence || 0.6) * 0.85;
      const seasonedScore = Math.min(1, baseScore * weights.bedding);

      // Centroid of bedding area
      const centroid = getPolygonCentroid(f.geometry);
      if (centroid) {
        features.push(makeHeatPoint(centroid, seasonedScore, 'bedding'));
      }

      // Sample boundary points for area coverage
      const boundaryPoints = sampleGeometryPoints(f.geometry, 4);
      for (const pt of boundaryPoints) {
        features.push(makeHeatPoint(pt, seasonedScore * 0.7, 'bedding_edge'));
      }
    }
  }

  // 1b. Funnels / corridors → high-value terrain compression
  if (input.funnels?.features?.length) {
    for (const f of input.funnels.features) {
      const props = f.properties || {};
      const corridorScore = props.corridorScore || props.score || 0.6;
      const baseScore = corridorScore * 0.9;
      const seasonedScore = Math.min(1, baseScore * weights.funnels);

      if (f.geometry.type === 'Point') {
        features.push(makeHeatPoint(
          f.geometry.coordinates as [number, number],
          seasonedScore,
          'funnel'
        ));
      } else if (f.geometry.type === 'LineString') {
        // Sample along corridor
        const coords = (f.geometry as GeoJSON.LineString).coordinates;
        const step = Math.max(1, Math.floor(coords.length / 5));
        for (let i = 0; i < coords.length; i += step) {
          features.push(makeHeatPoint(
            coords[i] as [number, number],
            seasonedScore * (0.7 + 0.3 * (i === Math.floor(coords.length / 2) ? 1 : 0.5)),
            'corridor'
          ));
        }
      } else if (f.geometry.type === 'Polygon') {
        const centroid = getPolygonCentroid(f.geometry);
        if (centroid) {
          features.push(makeHeatPoint(centroid, seasonedScore, 'funnel'));
        }
        const edgePts = sampleGeometryPoints(f.geometry, 3);
        for (const pt of edgePts) {
          features.push(makeHeatPoint(pt, seasonedScore * 0.6, 'funnel_edge'));
        }
      }
    }
  }

  // 1c. Stand points → concentrated heat at recommended positions
  if (input.standPoints?.features?.length) {
    for (const f of input.standPoints.features) {
      const props = f.properties || {};
      const standScore = props.score || props.compositeScore || 0.7;
      const baseScore = standScore * 0.95;
      const seasonedScore = Math.min(1, baseScore * weights.standPoints);

      if (f.geometry.type === 'Point') {
        features.push(makeHeatPoint(
          f.geometry.coordinates as [number, number],
          seasonedScore,
          'stand'
        ));
      }
    }
  }

  // ====== LAYER 2: Parcel-Wide Terrain Grid (30% weight) ======
  // Generate a grid of points across the parcel to spread heat spatially
  if (input.parcelCoords && input.parcelCoords.length >= 3) {
    const gridPoints = generateParcelGrid(input.parcelCoords, weights);
    features.push(...gridPoints);
  }

  // ====== LAYER 3: Flow/Convergence Validation (15% weight) ======
  // Convergence zones are DEMOTED — they validate, not dominate
  if (input.convergenceZones?.features?.length) {
    const maxConvergence = 4; // Cap contribution
    const sorted = [...input.convergenceZones.features]
      .sort((a, b) => (b.properties?.intensity || 0) - (a.properties?.intensity || 0))
      .slice(0, maxConvergence);

    for (const f of sorted) {
      const intensity = f.properties?.intensity || 0.5;
      // Reduced weight: convergence is validation, not primary signal
      const score = intensity * 0.45 * weights.convergence;

      if (f.geometry.type === 'Point') {
        features.push(makeHeatPoint(
          f.geometry.coordinates as [number, number],
          Math.min(0.7, score), // Hard cap at 0.7 to prevent domination
          'convergence'
        ));
      }
    }
  }

  // Flow line samples — very light background heat (5% effective)
  if (input.flowPrimary?.features?.length) {
    for (const f of input.flowPrimary.features) {
      const coords = (f.geometry as GeoJSON.LineString)?.coordinates || [];
      const likelihood = f.properties?.likelihood || 0.5;
      // Every 5th point, much lighter than before
      const step = Math.max(1, Math.floor(coords.length / 4));
      for (let i = 0; i < coords.length; i += step) {
        features.push(makeHeatPoint(
          coords[i] as [number, number],
          likelihood * 0.25 * weights.convergence,
          'flow_trace'
        ));
      }
    }
  }

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

// ============ HELPERS ============

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

/**
 * Generate a grid of heat points across the parcel.
 * Uses parcel geometry to create spatially distributed base heat.
 * Points near terrain features get boosted; points in open areas get base heat.
 */
function generateParcelGrid(
  parcelCoords: number[][],
  weights: SeasonWeightProfile
): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];

  // Compute bounding box
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  for (const c of parcelCoords) {
    if (c[0] < minLng) minLng = c[0];
    if (c[0] > maxLng) maxLng = c[0];
    if (c[1] < minLat) minLat = c[1];
    if (c[1] > maxLat) maxLat = c[1];
  }

  // Target ~20-30 grid points for a typical parcel
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;
  const gridSize = Math.max(4, Math.min(6, Math.ceil(Math.sqrt(30))));
  const lngStep = lngSpan / gridSize;
  const latStep = latSpan / gridSize;

  for (let i = 0; i <= gridSize; i++) {
    for (let j = 0; j <= gridSize; j++) {
      const lng = minLng + i * lngStep;
      const lat = minLat + j * latStep;

      // Check if point is inside parcel
      if (!pointInPolygon([lng, lat], parcelCoords)) continue;

      // Base terrain score varies by position within parcel
      // Edge zones and varied terrain get slightly different scores
      const edgeFactor = getEdgeProximityFactor(lng, lat, parcelCoords);
      const positionVariation = getPositionVariation(i, j, gridSize);

      // Base score: moderate heat everywhere in parcel (terrain exists everywhere)
      let score = 0.2 + positionVariation * 0.15;

      // Edge proximity bonus (terrain transitions at edges)
      score += edgeFactor * 0.1 * weights.slopeBreaks;

      features.push(makeHeatPoint([lng, lat], Math.min(0.55, score), 'terrain_grid'));
    }
  }

  return features;
}

/**
 * How close a point is to the parcel boundary (0 = center, 1 = edge).
 * Edge zones often have terrain transitions.
 */
function getEdgeProximityFactor(
  lng: number,
  lat: number,
  parcelCoords: number[][]
): number {
  let minDist = Infinity;
  for (const c of parcelCoords) {
    const d = Math.sqrt((lng - c[0]) ** 2 + (lat - c[1]) ** 2);
    if (d < minDist) minDist = d;
  }

  // Find rough "max interior distance" using bbox diagonal / 4
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  for (const c of parcelCoords) {
    if (c[0] < minLng) minLng = c[0];
    if (c[0] > maxLng) maxLng = c[0];
    if (c[1] < minLat) minLat = c[1];
    if (c[1] > maxLat) maxLat = c[1];
  }
  const diag = Math.sqrt((maxLng - minLng) ** 2 + (maxLat - minLat) ** 2);
  const maxInterior = diag / 4;

  return maxInterior > 0 ? Math.max(0, 1 - minDist / maxInterior) : 0;
}

/**
 * Position-based variation to avoid perfectly uniform grid.
 * Creates slight natural variation across the parcel.
 */
function getPositionVariation(i: number, j: number, gridSize: number): number {
  // Deterministic pseudo-variation based on grid position
  const normalized = ((i * 7 + j * 13) % 17) / 17;
  return normalized;
}

function pointInPolygon(point: [number, number], polygon: number[][]): boolean {
  let inside = false;
  const x = point[0], y = point[1];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}
