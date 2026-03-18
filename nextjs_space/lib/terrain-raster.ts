/**
 * Terrain Raster Pressure Surface v3.5 — Season Profiles v1.1 Visibility Tuning
 * 
 * Computes a grid-based terrain pressure map at 10-20m resolution.
 * Each cell gets bench/saddle/ridge scores based on proximity to terrain features,
 * plus a sidehill/leeward bonus for ridge shoulders and leeward benches.
 * 
 * pressure =
 *   0.40 × bench_score +
 *   0.30 × saddle_score +
 *   0.30 × ridge_score +
 *   sidehill_bonus (up to +30% in Late season)
 * 
 * Season Profiles v1.1 — Visibility Tuning:
 *   Early: bench 1.65×, saddle 0.55×, ridge 0.70× — softer, wider bench glow
 *   Rut:   bench 0.50×, saddle 1.80×, ridge 1.50× — tight pinch-point heat
 *   Late:  bench 1.35×, saddle 0.60×, ridge 0.50× — shelter-dominated pockets
 * 
 * Sidehill bonus favors:
 *   - Moderate slope bands (8-25%)
 *   - Cells slightly below ridge crest (20-60m offset)
 *   - NW/N/NE aspects (leeward bedding tendency)
 * 
 * Then applies Gaussian smoothing (1-2 cell kernel) for natural transitions.
 * 
 * KILL WINDOW MODEL (v3.2):
 * Prime Stand Sites are NOT placed at pressure maxima (where deer want to go).
 * Instead, they are OFFSET 25-40m toward the best intercept edge:
 *   - Pressure core = deer destination
 *   - Prime Stand Site = hunter intercept position
 * 
 * v3.4 REFINEMENTS:
 * 
 * COVER GATING:
 *   - Prevent open-field stand placements
 *   - Require ridge/bench proximity (indicates timber cover)
 *   - Exception for extreme terrain compression (narrow draw crossings)
 * 
 * WEAK PARCEL LIMITS:
 *   - Score < 35: limit to 0-1 stands
 *   - Score < 20: no stands recommended
 *   - Weak terrain should visually appear quiet
 */

import type { SeasonProfile } from '@/types/terrain';
import type { PressureFocus } from './terrain-heatmap';

// ============ POINT-IN-POLYGON (ray casting) ============
function pointInPolygon(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ============ GRID RESOLUTION ============
const CELL_SIZE_M = 15; // 15 meter cells (between 10-20m as requested)
const MIN_CELLS = 20;   // minimum grid dimension
const MAX_CELLS = 100;  // maximum grid dimension (prevents massive grids)

// ============ TERRAIN WEIGHTS ============
const W_BENCH  = 0.40;
const W_SADDLE = 0.30;
const W_RIDGE  = 0.30;

// ============ SIDEHILL / LEEWARD BONUS ============
// Modest bonus for ridge shoulders and leeward benches — not dominant
const SIDEHILL_BONUS_MAX = 0.12;  // up to +12% boost
const OPTIMAL_SLOPE_MIN = 0.08;   // 8% grade
const OPTIMAL_SLOPE_MAX = 0.25;   // 25% grade
const RIDGE_OFFSET_MIN_M = 20;    // minimum distance below ridge crest
const RIDGE_OFFSET_MAX_M = 60;    // maximum distance below ridge crest

// ============ KILL WINDOW OFFSET ============
// Shift Prime Stand Sites from pressure cores to intercept positions
const KILL_WINDOW_OFFSET_MIN_M = 25;  // minimum offset from pressure core
const KILL_WINDOW_OFFSET_MAX_M = 40;  // maximum offset from pressure core
const KILL_WINDOW_OFFSET_CELLS = 2;   // ~30m at 15m cell size (typical offset)

// ============ COVER GATING (v3.4) ============
// Prevent stand placement in open fields — require proximity to cover/timber
const COVER_GATING = {
  enabled: true,
  // Minimum terrain structure score for stand placement
  min_terrain_structure: 0.25,
  // Ridge/bench proximity indicates tree cover (ridges tend to be timbered)
  min_ridge_or_bench: 0.35,
  // Allow exception for extreme terrain compression (narrow draw crossings)
  extreme_terrain_exception_threshold: 0.85,
  // Penalty multiplier for low-cover hotspots
  open_field_penalty: 0.3,
};

// ============ WEAK PARCEL LIMITS (v3.4) ============
// Reduce stand count recommendations on parcels with weak terrain
const WEAK_PARCEL_CONFIG = {
  // Score threshold below which parcel is considered "weak"
  weak_score_threshold: 35,
  // Maximum stands on weak parcels
  weak_parcel_max_stands: 1,
  // Very weak threshold (no stands recommended)
  very_weak_score_threshold: 20,
};

// ============ INFLUENCE RADII (meters) ============
const BENCH_INFLUENCE_M  = 80;   // how far bench influence extends
const SADDLE_INFLUENCE_M = 120;  // saddles have wider influence
const RIDGE_INFLUENCE_M  = 60;   // ridge influence is tighter

// ============ SEASON PROFILES (v4.0 — Seasonal Terrain Weighting) ============
// Each season adjusts:
//   1. Base factor weights (bench/saddle/ridge) — existing
//   2. Influence radii multipliers — how far each terrain factor projects
//   3. Sidehill bonus ceiling — overall strength of slope/shelter layer
//   4. Slope preference weight — relative importance of moderate slopes
//   5. Shelter weight — relative importance of leeward thermal cover
//   6. Aspect bias strength — how strongly NW/N/NE aspects are favored
//
// These weights compound through the existing scoring pipeline so that
// corridor extraction and convergence detection shift with season.

interface SeasonWeightProfile {
  // Base terrain factor multipliers (applied to W_BENCH / W_SADDLE / W_RIDGE)
  bench: number;
  saddle: number;
  ridge: number;
  // Influence radius multipliers (scale BENCH_INFLUENCE_M etc.)
  benchInfluenceScale: number;
  saddleInfluenceScale: number;
  ridgeInfluenceScale: number;
  // Sidehill bonus ceiling (replaces SIDEHILL_BONUS_MAX per season)
  sidehillMax: number;
  // Component weights inside sidehill computation (must sum to ~1)
  slopeWeight: number;     // importance of moderate slope bands
  ridgeOffsetWeight: number; // importance of ridge shoulder positioning
  shelterWeight: number;   // importance of leeward/thermal aspect
  // Aspect scoring curve adjustment
  aspectBiasStrength: number; // 1.0 = default curve, >1 = stronger leeward preference
}

const SEASON_WEIGHTS: Record<SeasonProfile, SeasonWeightProfile> = {
  early: {
    // Early season v1.1: bench-dominant, food-adjacent browsing, broad softer heat
    // Benches are THE feature — deer are on food-to-bed patterns across wide areas.
    // Saddles and ridges barely register because territorial funneling hasn't started.
    bench: 1.65,  saddle: 0.55,  ridge: 0.70,
    benchInfluenceScale: 1.55,   // wide bench glow (browse/food patterns cast broadly)
    saddleInfluenceScale: 0.65,  // saddles nearly dormant (no funneling pressure yet)
    ridgeInfluenceScale: 0.75,   // ridges faint (cover matters, not travel spines)
    sidehillMax: 0.06,           // minimal sidehill bonus (warm weather, open movement)
    slopeWeight: 0.20,           // moderate slopes barely relevant
    ridgeOffsetWeight: 0.35,     // ridge-shoulder still matters for security cover
    shelterWeight: 0.45,         // shade preference, not thermal urgency
    aspectBiasStrength: 0.4,     // very weak leeward bias (warm, variable winds)
  },
  rut: {
    // Rut v1.1: saddle-dominant, ridge-crossing cruising, tight pinch-point heat
    // Saddles and ridges are everything — bucks cruise through pinch points
    // checking does. Benches nearly vanish because food patterns are abandoned.
    bench: 0.50,  saddle: 1.80,  ridge: 1.50,
    benchInfluenceScale: 0.60,   // benches recede (food irrelevant during rut)
    saddleInfluenceScale: 1.70,  // saddles project widely (cruising funnels)
    ridgeInfluenceScale: 1.40,   // ridges prominent (scent advantage from height)
    sidehillMax: 0.20,           // strong sidehill bonus (ridge running / slope travel)
    slopeWeight: 0.40,           // moderate slopes important for intercept angles
    ridgeOffsetWeight: 0.42,     // ridge shoulder is prime (scent-check from above)
    shelterWeight: 0.18,         // shelter barely matters (bucks move regardless)
    aspectBiasStrength: 0.75,    // mild leeward bias (wind matters but movement > shelter)
  },
  late: {
    // Late season v1.1: shelter-dominant, leeward thermal cover, tight survival zones
    // Thermal cover and wind protection are life-or-death. Deer conserve energy
    // in sheltered leeward pockets near food. Exposed ridges and open saddles
    // are actively avoided. Heat should pool in sheltered draws and NW/N/NE slopes.
    bench: 1.35,  saddle: 0.60,  ridge: 0.50,
    benchInfluenceScale: 1.15,   // moderate bench reach (food-return near cover)
    saddleInfluenceScale: 0.70,  // saddles subdued (exposed travel avoided)
    ridgeInfluenceScale: 0.60,   // ridge crests avoided (wind exposure)
    sidehillMax: 0.30,           // very high sidehill bonus (thermal cover is survival)
    slopeWeight: 0.15,           // slopes barely relevant
    ridgeOffsetWeight: 0.20,     // well below crest for maximum wind protection
    shelterWeight: 0.65,         // dominant: leeward thermal cover drives everything
    aspectBiasStrength: 2.0,     // very aggressive leeward bias (survival mode)
  },
};

// ============ FOCUS MODE CONFIG ============
const FOCUS_CONFIG: Record<PressureFocus, { scoreFloor: number; scoreGamma: number }> = {
  broad:    { scoreFloor: 0.02, scoreGamma: 0.70 },
  balanced: { scoreFloor: 0.08, scoreGamma: 1.00 },
  focused:  { scoreFloor: 0.18, scoreGamma: 1.40 },
};

// ============ TYPES ============
export interface RasterInput {
  /** Parcel boundary coordinates [[lng, lat], ...] */
  parcelCoords: number[][];
  /** Bedding polygons → bench likelihood */
  beddingPolygons?: GeoJSON.FeatureCollection;
  /** Ridge spine data */
  ridgeSpineData?: {
    ridges_primary?: GeoJSON.FeatureCollection;
    ridges_secondary?: GeoJSON.FeatureCollection;
    saddle_nodes?: GeoJSON.FeatureCollection;
  } | null;
  /** Season profile */
  season: SeasonProfile;
  /** Focus mode */
  focusMode?: PressureFocus;
}

export interface RasterCell {
  row: number;
  col: number;
  lng: number;
  lat: number;
  bench: number;     // 0-1 bench likelihood
  saddle: number;    // 0-1 saddle influence
  ridge: number;     // 0-1 ridge structure
  sidehill: number;  // 0-1 sidehill/leeward bonus
  pressure: number;  // combined 0-1 pressure score
}

export interface RasterGrid {
  cells: RasterCell[][];
  rows: number;
  cols: number;
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  cellSizeM: number;
}

export interface PrimeStandSite {
  lng: number;
  lat: number;
  score: number;
  rank: number;
  // Kill window offset metadata
  hotspotLng?: number;      // original hotspot center
  hotspotLat?: number;
  offsetDistanceM?: number; // actual offset applied
  offsetAngle?: number;     // direction of offset (degrees, 0=N, 90=E)
  interceptType?: 'gradient' | 'leeward' | 'sidehill' | 'combined';
}

// ============ UTILITY FUNCTIONS ============

/** Haversine distance in meters */
function distanceMeters(coord1: [number, number], coord2: [number, number]): number {
  const R = 6371000;
  const lat1 = coord1[1] * Math.PI / 180;
  const lat2 = coord2[1] * Math.PI / 180;
  const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
  const dLng = (coord2[0] - coord1[0]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Approximate meters per degree at given latitude */
function metersPerDegree(lat: number): { lng: number; lat: number } {
  const latRad = lat * Math.PI / 180;
  return {
    lng: 111320 * Math.cos(latRad),
    lat: 110540,
  };
}

/** Get polygon centroid */
function getPolygonCentroid(geometry: GeoJSON.Geometry): [number, number] | null {
  if (geometry.type === 'Polygon') {
    const coords = geometry.coordinates[0];
    if (!coords || coords.length === 0) return null;
    let sumLng = 0, sumLat = 0;
    for (const c of coords) {
      sumLng += c[0];
      sumLat += c[1];
    }
    return [sumLng / coords.length, sumLat / coords.length];
  }
  return null;
}

/** Sample points along a polygon boundary */
function samplePolygonPoints(geometry: GeoJSON.Geometry, count: number): [number, number][] {
  const points: [number, number][] = [];
  if (geometry.type !== 'Polygon') return points;
  const ring = geometry.coordinates[0];
  if (!ring || ring.length < 3) return points;
  
  // Sample evenly along the boundary
  const step = Math.max(1, Math.floor(ring.length / count));
  for (let i = 0; i < ring.length && points.length < count; i += step) {
    points.push([ring[i][0], ring[i][1]]);
  }
  
  // Add centroid
  const centroid = getPolygonCentroid(geometry);
  if (centroid) points.push(centroid);
  
  return points;
}

/** Sample points along a linestring */
function sampleLinePoints(coords: number[][], count: number): [number, number][] {
  const points: [number, number][] = [];
  if (!coords || coords.length < 2) return points;
  
  const step = Math.max(1, Math.floor(coords.length / count));
  for (let i = 0; i < coords.length && points.length < count; i += step) {
    points.push([coords[i][0], coords[i][1]]);
  }
  return points;
}

// ============ GRID GENERATION ============

/**
 * Generate a raster grid covering the parcel bounds.
 * Returns empty cells that will be populated with terrain scores.
 */
export function generateRasterGrid(parcelCoords: number[][]): RasterGrid | null {
  if (!parcelCoords || parcelCoords.length < 3) return null;

  // Find bounding box
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  for (const c of parcelCoords) {
    minLng = Math.min(minLng, c[0]);
    maxLng = Math.max(maxLng, c[0]);
    minLat = Math.min(minLat, c[1]);
    maxLat = Math.max(maxLat, c[1]);
  }

  // Add small buffer (5%)
  const bufferLng = (maxLng - minLng) * 0.05;
  const bufferLat = (maxLat - minLat) * 0.05;
  minLng -= bufferLng;
  maxLng += bufferLng;
  minLat -= bufferLat;
  maxLat += bufferLat;

  // Calculate grid dimensions
  const centerLat = (minLat + maxLat) / 2;
  const mpd = metersPerDegree(centerLat);
  
  const widthM = (maxLng - minLng) * mpd.lng;
  const heightM = (maxLat - minLat) * mpd.lat;

  let cols = Math.round(widthM / CELL_SIZE_M);
  let rows = Math.round(heightM / CELL_SIZE_M);

  // Clamp to reasonable range
  cols = Math.max(MIN_CELLS, Math.min(MAX_CELLS, cols));
  rows = Math.max(MIN_CELLS, Math.min(MAX_CELLS, rows));

  // Generate empty cells
  const cellWidthDeg = (maxLng - minLng) / cols;
  const cellHeightDeg = (maxLat - minLat) / rows;

  const cells: RasterCell[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: RasterCell[] = [];
    for (let c = 0; c < cols; c++) {
      const lng = minLng + (c + 0.5) * cellWidthDeg;
      const lat = minLat + (r + 0.5) * cellHeightDeg;
      row.push({
        row: r,
        col: c,
        lng,
        lat,
        bench: 0,
        saddle: 0,
        ridge: 0,
        sidehill: 0,
        pressure: 0,
      });
    }
    cells.push(row);
  }

  return {
    cells,
    rows,
    cols,
    bounds: { minLng, maxLng, minLat, maxLat },
    cellSizeM: CELL_SIZE_M,
  };
}

// ============ TERRAIN SCORING ============

/**
 * Compute proximity score: 1.0 at source, decaying to 0 at radius.
 * Uses inverse distance weighting with smooth falloff.
 */
function proximityScore(dist: number, radius: number): number {
  if (dist >= radius) return 0;
  // Smooth inverse quadratic falloff
  const t = dist / radius;
  return Math.max(0, 1 - t * t);
}

/**
 * Compute bench score for a cell based on proximity to bedding polygons.
 * @param influenceRadius Season-adjusted influence radius
 */
function computeBenchScore(
  cell: RasterCell,
  beddingPolygons: GeoJSON.FeatureCollection | undefined,
  influenceRadius: number = BENCH_INFLUENCE_M
): number {
  if (!beddingPolygons?.features?.length) return 0;

  let maxScore = 0;
  const cellCoord: [number, number] = [cell.lng, cell.lat];

  for (const f of beddingPolygons.features) {
    const confidence = (f.properties?.confidence as number) || 0.6;
    
    // Sample points from the polygon
    const points = samplePolygonPoints(f.geometry, 8);
    
    for (const pt of points) {
      const dist = distanceMeters(cellCoord, pt);
      const prox = proximityScore(dist, influenceRadius);
      const score = prox * confidence;
      maxScore = Math.max(maxScore, score);
    }
  }

  return Math.min(1, maxScore);
}

/**
 * Compute saddle score for a cell based on proximity to saddle nodes.
 * @param influenceRadius Season-adjusted influence radius
 */
function computeSaddleScore(
  cell: RasterCell,
  saddleNodes: GeoJSON.FeatureCollection | undefined,
  influenceRadius: number = SADDLE_INFLUENCE_M
): number {
  if (!saddleNodes?.features?.length) return 0;

  let maxScore = 0;
  const cellCoord: [number, number] = [cell.lng, cell.lat];

  for (const f of saddleNodes.features) {
    if (f.geometry.type !== 'Point') continue;
    const coord = f.geometry.coordinates as [number, number];
    const dist = distanceMeters(cellCoord, coord);
    const prox = proximityScore(dist, influenceRadius);
    const prominence = (f.properties?.prominence as number) || 0.7;
    const score = prox * Math.min(1, prominence);
    maxScore = Math.max(maxScore, score);
  }

  return Math.min(1, maxScore);
}

/**
 * Compute ridge score for a cell based on proximity to ridge lines.
 * @param influenceRadius Season-adjusted influence radius
 */
function computeRidgeScore(
  cell: RasterCell,
  ridgesPrimary: GeoJSON.FeatureCollection | undefined,
  ridgesSecondary: GeoJSON.FeatureCollection | undefined,
  influenceRadius: number = RIDGE_INFLUENCE_M
): number {
  const cellCoord: [number, number] = [cell.lng, cell.lat];
  let maxScore = 0;

  // Primary ridges (weight 1.0)
  if (ridgesPrimary?.features?.length) {
    for (const f of ridgesPrimary.features) {
      if (f.geometry.type !== 'LineString') continue;
      const coords = f.geometry.coordinates;
      const points = sampleLinePoints(coords, 10);
      
      for (const pt of points) {
        const dist = distanceMeters(cellCoord, pt);
        const prox = proximityScore(dist, influenceRadius);
        maxScore = Math.max(maxScore, prox * 1.0);
      }
    }
  }

  // Secondary ridges (weight 0.6)
  if (ridgesSecondary?.features?.length) {
    for (const f of ridgesSecondary.features) {
      if (f.geometry.type !== 'LineString') continue;
      const coords = f.geometry.coordinates;
      const points = sampleLinePoints(coords, 8);
      
      for (const pt of points) {
        const dist = distanceMeters(cellCoord, pt);
        const prox = proximityScore(dist, influenceRadius * 0.8);
        maxScore = Math.max(maxScore, prox * 0.6);
      }
    }
  }

  return Math.min(1, maxScore);
}

// ============ SIDEHILL / LEEWARD BONUS ============

/**
 * Compute sidehill/leeward bonus for a cell.
 * 
 * This bonus favors ridge shoulders and leeward benches — ideal for mature buck movement.
 * Three components with season-dependent weighting:
 *   1. Slope band: moderate slopes (8-25%) — stronger in Rut
 *   2. Ridge offset: cells 20-60m below ridge crest — strongest in Rut
 *   3. Aspect/shelter: NW/N/NE aspects — dominant in Late season (thermal cover)
 * 
 * v4.0: Season weights shift component balance so the sidehill layer
 *       emphasizes thermal cover in Late, slope intercepts in Rut,
 *       and stays modest in Early.
 * 
 * Returns 0-1 score that gets scaled by seasonal sidehillMax.
 */
function computeSidehillBonus(
  cell: RasterCell,
  grid: RasterGrid,
  ridgesPrimary: GeoJSON.FeatureCollection | undefined,
  ridgesSecondary: GeoJSON.FeatureCollection | undefined,
  seasonProfile?: SeasonWeightProfile
): number {
  // Component 1: Slope band score
  const slopeScore = computeSlopeProxy(cell, grid);
  
  // Component 2: Ridge offset score
  const ridgeOffsetScore = computeRidgeOffsetScore(cell, ridgesPrimary, ridgesSecondary);
  
  // Component 3: Aspect score (leeward tendency) with seasonal bias
  const rawAspect = computeAspectScore(cell, grid);
  // Apply seasonal bias strength: >1 amplifies leeward preference, <1 flattens it
  const biasStrength = seasonProfile?.aspectBiasStrength ?? 1.0;
  const aspectScore = biasStrength >= 1.0
    ? Math.pow(rawAspect, 1 / biasStrength) // amplify: push scores toward 1
    : rawAspect * biasStrength + (1 - biasStrength) * 0.5; // flatten toward neutral 0.5
  
  // Seasonal weighted combination (replaces equal-weight geometric mean)
  const wSlope = seasonProfile?.slopeWeight ?? 0.33;
  const wRidgeOff = seasonProfile?.ridgeOffsetWeight ?? 0.34;
  const wShelter = seasonProfile?.shelterWeight ?? 0.33;
  
  // Weighted power mean — rewards the seasonally important components
  // When shelter weight is high (Late), aspect score dominates
  // When slope weight is high (Rut), moderate slopes dominate
  const combined = 
    wSlope * Math.max(0.01, slopeScore) +
    wRidgeOff * Math.max(0.01, ridgeOffsetScore) +
    wShelter * Math.max(0.01, aspectScore);
  
  // Apply soft diminishing returns to prevent over-saturation
  return Math.min(1, Math.pow(combined, 0.85));
}

/**
 * Estimate slope from grid gradient.
 * Uses difference in terrain scores as elevation proxy.
 * Returns 1.0 for optimal slope band (8-25%), fading outside.
 */
function computeSlopeProxy(cell: RasterCell, grid: RasterGrid): number {
  const r = cell.row;
  const c = cell.col;
  
  // Need neighbors to compute gradient
  if (r < 1 || r >= grid.rows - 1 || c < 1 || c >= grid.cols - 1) {
    return 0.3; // edge cells get modest score
  }
  
  // Use ridge score as elevation proxy (higher ridge = higher elevation)
  const centerElev = grid.cells[r][c].ridge;
  const northElev = grid.cells[r - 1][c].ridge;
  const southElev = grid.cells[r + 1][c].ridge;
  const eastElev = grid.cells[r][c + 1].ridge;
  const westElev = grid.cells[r][c - 1].ridge;
  
  // Compute gradient magnitude
  const dLat = (northElev - southElev) / 2;
  const dLng = (eastElev - westElev) / 2;
  const gradient = Math.sqrt(dLat * dLat + dLng * dLng);
  
  // Map gradient to slope band score
  // Optimal is 8-25% (gradient 0.08-0.25 in our normalized space)
  const normalizedSlope = gradient * 3; // scale factor for our terrain scores
  
  if (normalizedSlope < OPTIMAL_SLOPE_MIN) {
    // Too flat — partial credit
    return normalizedSlope / OPTIMAL_SLOPE_MIN * 0.5;
  } else if (normalizedSlope <= OPTIMAL_SLOPE_MAX) {
    // Optimal band — full credit
    return 1.0;
  } else if (normalizedSlope < 0.40) {
    // Steeper but still huntable
    return 1.0 - (normalizedSlope - OPTIMAL_SLOPE_MAX) / 0.15 * 0.5;
  } else {
    // Too steep
    return 0.2;
  }
}

/**
 * Compute ridge offset score.
 * Rewards cells that are close to but not directly on ridges.
 * Sweet spot: 20-60m below the crest.
 */
function computeRidgeOffsetScore(
  cell: RasterCell,
  ridgesPrimary: GeoJSON.FeatureCollection | undefined,
  ridgesSecondary: GeoJSON.FeatureCollection | undefined
): number {
  const cellCoord: [number, number] = [cell.lng, cell.lat];
  let minDist = Infinity;
  
  // Find distance to nearest ridge
  const checkRidges = (fc: GeoJSON.FeatureCollection | undefined, sampleCount: number) => {
    if (!fc?.features?.length) return;
    for (const f of fc.features) {
      if (f.geometry.type !== 'LineString') continue;
      const coords = f.geometry.coordinates;
      const step = Math.max(1, Math.floor(coords.length / sampleCount));
      for (let i = 0; i < coords.length; i += step) {
        const pt: [number, number] = [coords[i][0], coords[i][1]];
        const dist = distanceMeters(cellCoord, pt);
        minDist = Math.min(minDist, dist);
      }
    }
  };
  
  checkRidges(ridgesPrimary, 12);
  checkRidges(ridgesSecondary, 8);
  
  if (minDist === Infinity) return 0.3; // no ridges found — modest default
  
  // Score based on offset distance
  if (minDist < RIDGE_OFFSET_MIN_M) {
    // Too close to crest (exposed, windy)
    return 0.4 + (minDist / RIDGE_OFFSET_MIN_M) * 0.3;
  } else if (minDist <= RIDGE_OFFSET_MAX_M) {
    // Sweet spot — ridge shoulder
    return 1.0;
  } else if (minDist < 100) {
    // Still decent — upper slope
    return 1.0 - (minDist - RIDGE_OFFSET_MAX_M) / 40 * 0.5;
  } else {
    // Too far from ridge
    return 0.3;
  }
}

/**
 * Compute aspect score favoring leeward (NW/N/NE) aspects.
 * Uses terrain gradient direction as aspect proxy.
 */
function computeAspectScore(cell: RasterCell, grid: RasterGrid): number {
  const r = cell.row;
  const c = cell.col;
  
  if (r < 1 || r >= grid.rows - 1 || c < 1 || c >= grid.cols - 1) {
    return 0.5; // edge cells get neutral score
  }
  
  // Use ridge scores to estimate downhill direction
  const northElev = grid.cells[r - 1][c].ridge;
  const southElev = grid.cells[r + 1][c].ridge;
  const eastElev = grid.cells[r][c + 1].ridge;
  const westElev = grid.cells[r][c - 1].ridge;
  
  // Gradient points downhill
  const dLat = southElev - northElev; // positive = facing north
  const dLng = westElev - eastElev;   // positive = facing east
  
  // Compute aspect angle (0 = N, 90 = E, 180 = S, 270 = W)
  let aspect = Math.atan2(dLng, dLat) * 180 / Math.PI;
  if (aspect < 0) aspect += 360;
  
  // Score leeward aspects (NW/N/NE = roughly 270-360 and 0-90)
  // Peak at N (0/360), fade to E (90) and W (270), low at S (180)
  const distFromNorth = Math.min(aspect, 360 - aspect);
  
  if (distFromNorth <= 45) {
    // NW to NE — optimal leeward
    return 1.0;
  } else if (distFromNorth <= 90) {
    // W to WNW or E to ENE — good
    return 0.8 - (distFromNorth - 45) / 45 * 0.3;
  } else if (distFromNorth <= 135) {
    // SW to SSW or SE to SSE — exposed
    return 0.5 - (distFromNorth - 90) / 45 * 0.2;
  } else {
    // S — most exposed
    return 0.3;
  }
}

// ============ GAUSSIAN SMOOTHING ============

/**
 * Apply Gaussian smoothing to the pressure surface.
 * Uses a 3x3 kernel (1-cell radius) for light smoothing.
 */
function applyGaussianSmoothing(grid: RasterGrid): void {
  // 3x3 Gaussian kernel (sigma ≈ 0.85)
  const kernel = [
    [0.0625, 0.125, 0.0625],
    [0.125,  0.25,  0.125],
    [0.0625, 0.125, 0.0625],
  ];

  // Create a copy of pressure values
  const original: number[][] = [];
  for (let r = 0; r < grid.rows; r++) {
    original.push(grid.cells[r].map(c => c.pressure));
  }

  // Apply convolution
  for (let r = 1; r < grid.rows - 1; r++) {
    for (let c = 1; c < grid.cols - 1; c++) {
      let sum = 0;
      for (let kr = -1; kr <= 1; kr++) {
        for (let kc = -1; kc <= 1; kc++) {
          sum += original[r + kr][c + kc] * kernel[kr + 1][kc + 1];
        }
      }
      grid.cells[r][c].pressure = sum;
    }
  }
}

// ============ MAIN BUILD FUNCTION ============

/**
 * Build a raster-based terrain pressure surface.
 * Returns both the grid and GeoJSON heat points.
 */
export function buildTerrainRaster(input: RasterInput): {
  grid: RasterGrid;
  heatPoints: GeoJSON.FeatureCollection;
  primeStandSites: PrimeStandSite[];
} | null {
  // Generate grid
  const grid = generateRasterGrid(input.parcelCoords);
  if (!grid) {
    return null;
  }

  const sw = SEASON_WEIGHTS[input.season] || SEASON_WEIGHTS.rut;
  const focus = FOCUS_CONFIG[input.focusMode ?? 'balanced'];

  // Compute season-adjusted influence radii
  const benchRadius = BENCH_INFLUENCE_M * sw.benchInfluenceScale;
  const saddleRadius = SADDLE_INFLUENCE_M * sw.saddleInfluenceScale;
  const ridgeRadius = RIDGE_INFLUENCE_M * sw.ridgeInfluenceScale;

  console.log(`[TerrainRaster] Season: ${input.season} | Influence radii — bench: ${benchRadius.toFixed(0)}m, saddle: ${saddleRadius.toFixed(0)}m, ridge: ${ridgeRadius.toFixed(0)}m | Sidehill max: ${(sw.sidehillMax * 100).toFixed(0)}%`);

  // Pass 1: Compute base terrain scores for each cell with seasonal influence radii
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];

      // Compute raw terrain component scores with season-adjusted radii
      cell.bench = computeBenchScore(cell, input.beddingPolygons, benchRadius);
      cell.saddle = computeSaddleScore(cell, input.ridgeSpineData?.saddle_nodes, saddleRadius);
      cell.ridge = computeRidgeScore(
        cell,
        input.ridgeSpineData?.ridges_primary,
        input.ridgeSpineData?.ridges_secondary,
        ridgeRadius
      );
    }
  }

  // Pass 2: Compute sidehill bonus with seasonal component weights
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];
      cell.sidehill = computeSidehillBonus(
        cell,
        grid,
        input.ridgeSpineData?.ridges_primary,
        input.ridgeSpineData?.ridges_secondary,
        sw
      );
    }
  }

  // Pass 3: Combine scores with weights and seasonal sidehill bonus
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];

      // Apply season weights and combine base terrain
      const benchW = cell.bench * sw.bench * W_BENCH;
      const saddleW = cell.saddle * sw.saddle * W_SADDLE;
      const ridgeW = cell.ridge * sw.ridge * W_RIDGE;
      const basePressure = benchW + saddleW + ridgeW;

      // Add sidehill bonus (scaled by seasonal ceiling and base pressure)
      // This ensures sidehill doesn't create heat on empty cells
      const sidehillBonus = cell.sidehill * sw.sidehillMax * Math.min(1, basePressure * 2);

      cell.pressure = basePressure + sidehillBonus;
    }
  }

  // Apply Gaussian smoothing (light, 1-cell radius)
  applyGaussianSmoothing(grid);

  // Normalize pressure to 0-1 range
  let maxPressure = 0;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      maxPressure = Math.max(maxPressure, grid.cells[r][c].pressure);
    }
  }
  if (maxPressure > 0) {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        grid.cells[r][c].pressure /= maxPressure;
      }
    }
  }

  // Convert to GeoJSON heat points with focus mode filtering
  // v3.5 — raised hard floor to 0.65 so only the hottest ~10-20% of cells survive
  const HARD_PRESSURE_FLOOR = 0.65;
  const parcelRing = input.parcelCoords;
  let features: GeoJSON.Feature[] = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];
      const raw = cell.pressure;

      // Apply hard pressure floor (filters ~80-90% of cells)
      if (raw < HARD_PRESSURE_FLOOR) continue;

      // Apply focus mode floor on top of hard floor
      if (raw < focus.scoreFloor) continue;

      // Clip to parcel boundary — no heat bleed onto lakes/neighbors
      if (parcelRing.length >= 3 && !pointInPolygon(cell.lng, cell.lat, parcelRing)) continue;

      // Normalize and apply gamma
      const norm = (raw - focus.scoreFloor) / (1 - focus.scoreFloor);
      const shaped = Math.pow(Math.max(0, Math.min(1, norm)), focus.scoreGamma);

      features.push({
        type: 'Feature',
        properties: {
          score: shaped,
          intensity: shaped,
          bench: cell.bench,
          saddle: cell.saddle,
          ridge: cell.ridge,
          sidehill: cell.sidehill,
          source: 'raster',
        },
        geometry: {
          type: 'Point',
          coordinates: [cell.lng, cell.lat],
        },
      });
    }
  }

  // Hard cap: keep only the top 500 highest-scoring cells
  if (features.length > 500) {
    features.sort((a, b) => (b.properties?.score ?? 0) - (a.properties?.score ?? 0));
    features = features.slice(0, 500);
  }

  // Extract Prime Stand Sites using Kill Window model
  // (offset from hotspot centers toward intercept edges)
  const primeStandSites = extractPrimeStandSites(grid, 3, input.ridgeSpineData, undefined, parcelRing);

  return {
    grid,
    heatPoints: { type: 'FeatureCollection', features },
    primeStandSites,
  };
}

// ============ KILL WINDOW OFFSET SYSTEM ============

interface HotspotCandidate {
  row: number;
  col: number;
  pressure: number;
  cell: RasterCell;
}

/**
 * Compute the optimal intercept direction for a hotspot.
 * Returns angle in degrees (0=N, 90=E, 180=S, 270=W) and confidence.
 * 
 * Considers:
 *   1. Pressure gradient (intercept deer approaching the core)
 *   2. Leeward preference (NW/N/NE for wind advantage)
 *   3. Sidehill/downhill preference (thermals, exit routes)
 */
function computeInterceptDirection(
  hotspot: HotspotCandidate,
  grid: RasterGrid,
  ridgesPrimary?: GeoJSON.FeatureCollection,
  ridgesSecondary?: GeoJSON.FeatureCollection
): { angle: number; confidence: number; type: 'gradient' | 'leeward' | 'sidehill' | 'combined' } {
  const r = hotspot.row;
  const c = hotspot.col;
  
  // Compute pressure gradient (points TOWARD higher pressure = where deer come FROM)
  // We want to offset TOWARD the incoming direction to intercept
  let gradDr = 0, gradDc = 0;
  let gradMag = 0;
  
  if (r >= 2 && r < grid.rows - 2 && c >= 2 && c < grid.cols - 2) {
    // Use a wider kernel for smoother gradient
    const pN = (grid.cells[r-1][c].pressure + grid.cells[r-2][c].pressure) / 2;
    const pS = (grid.cells[r+1][c].pressure + grid.cells[r+2][c].pressure) / 2;
    const pE = (grid.cells[r][c+1].pressure + grid.cells[r][c+2].pressure) / 2;
    const pW = (grid.cells[r][c-1].pressure + grid.cells[r][c-2].pressure) / 2;
    
    // Gradient points from low to high pressure
    // But we want to intercept incoming deer, so offset toward LOWER pressure
    // (deer are moving FROM lower pressure areas TOWARD the hotspot)
    gradDr = pN - pS; // positive = intercept from north
    gradDc = pW - pE; // positive = intercept from west
    gradMag = Math.sqrt(gradDr * gradDr + gradDc * gradDc);
  }
  
  // Compute leeward direction score
  // NW/N/NE aspects get boost (prevailing winds from W/SW in most of US)
  // We want hunter on the leeward side for scent control
  const leewardDr = -1; // north (leeward)
  const leewardDc = -0.3; // slight west bias
  
  // Compute sidehill/downhill direction using ridge scores
  // Hunter should be slightly below the ridge crest (thermal advantage)
  let sidehillDr = 0, sidehillDc = 0;
  if (r >= 1 && r < grid.rows - 1 && c >= 1 && c < grid.cols - 1) {
    const ridgeN = grid.cells[r-1][c].ridge;
    const ridgeS = grid.cells[r+1][c].ridge;
    const ridgeE = grid.cells[r][c+1].ridge;
    const ridgeW = grid.cells[r][c-1].ridge;
    
    // Point away from ridge crest (toward lower ridge scores = downhill)
    sidehillDr = ridgeS - ridgeN; // positive = move south (away from north ridge)
    sidehillDc = ridgeE - ridgeW; // positive = move east (away from west ridge)
    
    // Normalize
    const sidehillMag = Math.sqrt(sidehillDr * sidehillDr + sidehillDc * sidehillDc);
    if (sidehillMag > 0.01) {
      sidehillDr /= sidehillMag;
      sidehillDc /= sidehillMag;
    }
  }
  
  // Combine vectors with weights
  // Gradient is primary (intercept incoming deer)
  // Leeward is secondary (scent control)
  // Sidehill is tertiary (thermals, visibility)
  const W_GRAD = 0.50;
  const W_LEEWARD = 0.30;
  const W_SIDEHILL = 0.20;
  
  let finalDr: number, finalDc: number;
  let interceptType: 'gradient' | 'leeward' | 'sidehill' | 'combined';
  
  if (gradMag > 0.05) {
    // Good gradient signal — use it primarily
    const normGradDr = gradDr / gradMag;
    const normGradDc = gradDc / gradMag;
    
    finalDr = normGradDr * W_GRAD + leewardDr * W_LEEWARD + sidehillDr * W_SIDEHILL;
    finalDc = normGradDc * W_GRAD + leewardDc * W_LEEWARD + sidehillDc * W_SIDEHILL;
    interceptType = 'combined';
  } else {
    // Weak gradient — rely more on leeward/sidehill
    finalDr = leewardDr * 0.6 + sidehillDr * 0.4;
    finalDc = leewardDc * 0.6 + sidehillDc * 0.4;
    interceptType = hotspot.cell.sidehill > 0.5 ? 'sidehill' : 'leeward';
  }
  
  // Normalize final direction
  const finalMag = Math.sqrt(finalDr * finalDr + finalDc * finalDc);
  if (finalMag > 0) {
    finalDr /= finalMag;
    finalDc /= finalMag;
  } else {
    // Fallback: offset to the north (leeward default)
    finalDr = -1;
    finalDc = 0;
    interceptType = 'leeward';
  }
  
  // Convert to angle (0=N, 90=E, 180=S, 270=W)
  // Note: row increases going south, col increases going east
  // So finalDr < 0 means north, finalDc > 0 means east
  let angle = Math.atan2(finalDc, -finalDr) * 180 / Math.PI;
  if (angle < 0) angle += 360;
  
  // Confidence based on gradient strength and terrain structure
  const terrainScore = (hotspot.cell.ridge + hotspot.cell.saddle + hotspot.cell.sidehill) / 3;
  const confidence = Math.min(1, gradMag * 5 + terrainScore * 0.5);
  
  return { angle, confidence, type: interceptType };
}

/**
 * Apply kill window offset to a hotspot center.
 * Returns the optimal stand site position (intercept edge).
 */
function applyKillWindowOffset(
  hotspot: HotspotCandidate,
  grid: RasterGrid,
  offsetDirection: { angle: number; confidence: number; type: 'gradient' | 'leeward' | 'sidehill' | 'combined' }
): { lng: number; lat: number; offsetM: number } {
  const hotspotCell = hotspot.cell;
  const mpd = metersPerDegree(hotspotCell.lat);
  
  // Compute offset distance (25-40m based on confidence and terrain)
  // Higher confidence = more aggressive offset
  const baseOffset = KILL_WINDOW_OFFSET_MIN_M + 
    (KILL_WINDOW_OFFSET_MAX_M - KILL_WINDOW_OFFSET_MIN_M) * offsetDirection.confidence;
  
  // Adjust offset based on terrain type
  // Saddles get slightly less offset (pinch points are already tight)
  // Ridges get more offset (larger area to cover)
  let offsetM = baseOffset;
  if (hotspotCell.saddle > 0.6) {
    offsetM *= 0.8; // tighter offset at saddles
  } else if (hotspotCell.ridge > 0.6) {
    offsetM *= 1.1; // wider offset along ridges
  }
  
  // Clamp to valid range
  offsetM = Math.max(KILL_WINDOW_OFFSET_MIN_M, Math.min(KILL_WINDOW_OFFSET_MAX_M, offsetM));
  
  // Convert angle to direction vector
  // angle: 0=N, 90=E, 180=S, 270=W
  const angleRad = offsetDirection.angle * Math.PI / 180;
  const dLng = Math.sin(angleRad) * offsetM / mpd.lng;
  const dLat = Math.cos(angleRad) * offsetM / mpd.lat;
  
  return {
    lng: hotspotCell.lng + dLng,
    lat: hotspotCell.lat + dLat,
    offsetM,
  };
}

/**
 * Evaluate cover quality for a hotspot cell.
 * Returns a cover score (0-1) based on terrain structure.
 * High ridge/bench proximity = likely timbered cover.
 */
function evaluateCoverQuality(cell: RasterCell): {
  coverScore: number;
  hasAdequateCover: boolean;
  coverType: 'timber' | 'edge' | 'open' | 'draw';
} {
  // Ridge proximity suggests timber cover (ridges are typically timbered)
  const ridgeContrib = cell.ridge * 0.6;
  // Bench areas often have cover (transition zones)
  const benchContrib = cell.bench * 0.3;
  // Sidehill bonus indicates terrain structure (not open field)
  const sidehillContrib = cell.sidehill * 0.1;
  
  const coverScore = ridgeContrib + benchContrib + sidehillContrib;
  
  // Determine cover type
  let coverType: 'timber' | 'edge' | 'draw' | 'open';
  if (cell.ridge > 0.5 && cell.bench > 0.3) {
    coverType = 'timber';
  } else if (cell.ridge > 0.3 || cell.bench > 0.5) {
    coverType = 'edge';
  } else if (cell.saddle > 0.4) {
    coverType = 'draw'; // Saddles/draws often have cover
  } else {
    coverType = 'open';
  }
  
  // Check if adequate cover is present
  const hasAdequateCover = 
    coverScore >= COVER_GATING.min_ridge_or_bench ||
    cell.ridge >= COVER_GATING.min_ridge_or_bench ||
    cell.bench >= COVER_GATING.min_ridge_or_bench;
  
  return { coverScore, hasAdequateCover, coverType };
}

/**
 * Extract Prime Stand Sites using the Kill Window model with Cover Gating.
 * 
 * v3.4 Enhancements:
 * - COVER GATING: Reject open-field hotspots unless extreme terrain compression
 * - WEAK PARCEL LIMITS: Reduce recommendations on weak terrain parcels
 * 
 * Pipeline:
 * 1. Find local pressure maxima (hotspot centers / deer destinations)
 * 2. Apply cover gating (reject open-field candidates)
 * 3. Compute optimal intercept direction for each hotspot
 * 4. Offset stand sites 25-40m toward the intercept edge
 * 5. Respect weak parcel stand limits
 * 
 * Result: Stand sites positioned for ambush in believable terrain locations.
 */
function extractPrimeStandSites(
  grid: RasterGrid,
  maxCount: number,
  ridgeSpineData?: {
    ridges_primary?: GeoJSON.FeatureCollection;
    ridges_secondary?: GeoJSON.FeatureCollection;
  } | null,
  huntabilityScore?: number, // Optional: pass score to apply weak parcel limits
  parcelRing?: number[][]    // Optional: clip stand sites to parcel boundary
): PrimeStandSite[] {
  // Step 0: Determine effective max count based on huntability score
  let effectiveMaxCount = maxCount;
  
  if (huntabilityScore !== undefined) {
    if (huntabilityScore < WEAK_PARCEL_CONFIG.very_weak_score_threshold) {
      // Very weak terrain: no stands recommended
      console.log('[PrimeStandSites] Very weak parcel (score < 20), no stands recommended');
      return [];
    }
    if (huntabilityScore < WEAK_PARCEL_CONFIG.weak_score_threshold) {
      // Weak terrain: limit to 1 stand
      effectiveMaxCount = Math.min(maxCount, WEAK_PARCEL_CONFIG.weak_parcel_max_stands);
      console.log('[PrimeStandSites] Weak parcel (score < 35), limiting to', effectiveMaxCount, 'stands');
    }
  }
  
  const candidates: HotspotCandidate[] = [];

  // Step 1: Find local pressure maxima (hotspot centers)
  for (let r = 2; r < grid.rows - 2; r++) {
    for (let c = 2; c < grid.cols - 2; c++) {
      const cell = grid.cells[r][c];
      const center = cell.pressure;
      if (center < 0.25) continue; // minimum threshold

      // Check if this cell is a local maximum (higher than all 8 neighbors)
      let isMax = true;
      for (let dr = -1; dr <= 1 && isMax; dr++) {
        for (let dc = -1; dc <= 1 && isMax; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (grid.cells[r + dr][c + dc].pressure >= center) {
            isMax = false;
          }
        }
      }

      if (isMax) {
        // Skip candidates outside the parcel boundary
        if (parcelRing && parcelRing.length >= 3 && !pointInPolygon(cell.lng, cell.lat, parcelRing)) continue;
        candidates.push({ row: r, col: c, pressure: center, cell });
      }
    }
  }

  // Sort by pressure (highest first)
  candidates.sort((a, b) => b.pressure - a.pressure);

  // Step 2, 3, 4: For each hotspot, apply cover gating, compute intercept, and apply offset
  const MIN_SEPARATION_CELLS = 4; // ~60m at 15m cell size
  const selected: (PrimeStandSite & { _row: number; _col: number })[] = [];

  for (const hotspot of candidates) {
    if (selected.length >= effectiveMaxCount) break;

    // === COVER GATING (v3.4) ===
    if (COVER_GATING.enabled) {
      const coverEval = evaluateCoverQuality(hotspot.cell);
      
      // Check if this is an open-field hotspot
      if (!coverEval.hasAdequateCover) {
        // Allow exception for extreme terrain compression (narrow draw crossing)
        const isExtremeTerrain = hotspot.pressure >= COVER_GATING.extreme_terrain_exception_threshold;
        const hasDrawFeature = hotspot.cell.saddle > 0.5; // Saddle often indicates draw crossing
        
        if (isExtremeTerrain && hasDrawFeature) {
          console.log('[PrimeStandSites] Open-field exception: extreme terrain draw crossing at', 
            hotspot.cell.lng.toFixed(5), hotspot.cell.lat.toFixed(5));
        } else {
          // Reject this open-field hotspot
          console.log('[PrimeStandSites] Rejected open-field hotspot (cover:', coverEval.coverScore.toFixed(2), 
            'type:', coverEval.coverType, ') at', 
            hotspot.cell.lng.toFixed(5), hotspot.cell.lat.toFixed(5));
          continue;
        }
      }
    }

    // Compute intercept direction
    const interceptDir = computeInterceptDirection(
      hotspot,
      grid,
      ridgeSpineData?.ridges_primary,
      ridgeSpineData?.ridges_secondary
    );

    // Apply kill window offset
    const offsetPos = applyKillWindowOffset(hotspot, grid, interceptDir);

    // Check distance from already-selected sites (use offset position)
    let tooClose = false;
    for (const sel of selected) {
      // Use cell distance to hotspot center for separation check
      const cellDist = Math.sqrt(
        Math.pow(hotspot.row - sel._row, 2) +
        Math.pow(hotspot.col - sel._col, 2)
      );
      if (cellDist < MIN_SEPARATION_CELLS) {
        tooClose = true;
        break;
      }
    }

    if (!tooClose) {
      const site: PrimeStandSite & { _row: number; _col: number } = {
        lng: offsetPos.lng,
        lat: offsetPos.lat,
        score: hotspot.pressure,
        rank: selected.length + 1,
        // Kill window metadata
        hotspotLng: hotspot.cell.lng,
        hotspotLat: hotspot.cell.lat,
        offsetDistanceM: offsetPos.offsetM,
        offsetAngle: interceptDir.angle,
        interceptType: interceptDir.type,
        // Internal tracking
        _row: hotspot.row,
        _col: hotspot.col,
      };
      selected.push(site);
    }
  }

  // Clean up internal tracking properties
  return selected.map(({ _row, _col, ...rest }) => rest);
}

/**
 * Convert Prime Stand Sites to GeoJSON for map rendering.
 * Includes kill window metadata for enhanced tooltips.
 */
export function primeStandSitesToGeoJSON(
  sites: PrimeStandSite[]
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: sites.map((s, i) => ({
      type: 'Feature' as const,
      properties: {
        id: `pss_raster_${i}`,
        score: s.score,
        rank: s.rank,
        flowIntensity: s.score,
        convergenceBonus: 0,
        benchBonus: s.score * 0.40,
        saddleBonus: s.score * 0.30,
        sidehillBonus: s.score * 0.12,
        radiusM: 50,
        // Kill window offset metadata
        hotspotLng: s.hotspotLng,
        hotspotLat: s.hotspotLat,
        offsetDistanceM: s.offsetDistanceM,
        offsetAngle: s.offsetAngle,
        interceptType: s.interceptType,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [s.lng, s.lat],
      },
    })),
  };
}
