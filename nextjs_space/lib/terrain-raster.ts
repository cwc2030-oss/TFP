/**
 * Terrain Raster Pressure Surface
 * 
 * Computes a grid-based terrain pressure map at 10-20m resolution.
 * Each cell gets bench/saddle/ridge scores based on proximity to terrain features.
 * 
 * pressure = 0.40 × bench_score + 0.30 × saddle_score + 0.30 × ridge_score
 * 
 * Then applies Gaussian smoothing (1-2 cell kernel) for natural transitions.
 * Opportunity zones are extracted from local maxima in the pressure surface.
 */

import type { SeasonProfile } from '@/types/terrain';
import type { PressureFocus } from './terrain-heatmap';

// ============ GRID RESOLUTION ============
const CELL_SIZE_M = 15; // 15 meter cells (between 10-20m as requested)
const MIN_CELLS = 20;   // minimum grid dimension
const MAX_CELLS = 100;  // maximum grid dimension (prevents massive grids)

// ============ TERRAIN WEIGHTS ============
const W_BENCH  = 0.40;
const W_SADDLE = 0.30;
const W_RIDGE  = 0.30;

// ============ INFLUENCE RADII (meters) ============
const BENCH_INFLUENCE_M  = 80;   // how far bench influence extends
const SADDLE_INFLUENCE_M = 120;  // saddles have wider influence
const RIDGE_INFLUENCE_M  = 60;   // ridge influence is tighter

// ============ SEASON PROFILES ============
const SEASON_WEIGHTS: Record<SeasonProfile, { bench: number; saddle: number; ridge: number }> = {
  early: { bench: 1.3, saddle: 0.8, ridge: 0.9 },
  rut:   { bench: 0.8, saddle: 1.4, ridge: 1.2 },
  late:  { bench: 1.2, saddle: 0.9, ridge: 0.8 },
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
  bench: number;   // 0-1 bench likelihood
  saddle: number;  // 0-1 saddle influence
  ridge: number;   // 0-1 ridge structure
  pressure: number; // combined 0-1 pressure score
}

export interface RasterGrid {
  cells: RasterCell[][];
  rows: number;
  cols: number;
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  cellSizeM: number;
}

export interface OpportunityZone {
  lng: number;
  lat: number;
  score: number;
  rank: number;
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
 */
function computeBenchScore(
  cell: RasterCell,
  beddingPolygons: GeoJSON.FeatureCollection | undefined
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
      const prox = proximityScore(dist, BENCH_INFLUENCE_M);
      const score = prox * confidence;
      maxScore = Math.max(maxScore, score);
    }
  }

  return Math.min(1, maxScore);
}

/**
 * Compute saddle score for a cell based on proximity to saddle nodes.
 */
function computeSaddleScore(
  cell: RasterCell,
  saddleNodes: GeoJSON.FeatureCollection | undefined
): number {
  if (!saddleNodes?.features?.length) return 0;

  let maxScore = 0;
  const cellCoord: [number, number] = [cell.lng, cell.lat];

  for (const f of saddleNodes.features) {
    if (f.geometry.type !== 'Point') continue;
    const coord = f.geometry.coordinates as [number, number];
    const dist = distanceMeters(cellCoord, coord);
    const prox = proximityScore(dist, SADDLE_INFLUENCE_M);
    const prominence = (f.properties?.prominence as number) || 0.7;
    const score = prox * Math.min(1, prominence);
    maxScore = Math.max(maxScore, score);
  }

  return Math.min(1, maxScore);
}

/**
 * Compute ridge score for a cell based on proximity to ridge lines.
 */
function computeRidgeScore(
  cell: RasterCell,
  ridgesPrimary: GeoJSON.FeatureCollection | undefined,
  ridgesSecondary: GeoJSON.FeatureCollection | undefined
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
        const prox = proximityScore(dist, RIDGE_INFLUENCE_M);
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
        const prox = proximityScore(dist, RIDGE_INFLUENCE_M * 0.8);
        maxScore = Math.max(maxScore, prox * 0.6);
      }
    }
  }

  return Math.min(1, maxScore);
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
  opportunityZones: OpportunityZone[];
} | null {
  // Generate grid
  const grid = generateRasterGrid(input.parcelCoords);
  if (!grid) {
    return null;
  }

  const sw = SEASON_WEIGHTS[input.season] || SEASON_WEIGHTS.rut;
  const focus = FOCUS_CONFIG[input.focusMode ?? 'balanced'];

  // Compute terrain scores for each cell
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];

      // Compute raw terrain component scores
      cell.bench = computeBenchScore(cell, input.beddingPolygons);
      cell.saddle = computeSaddleScore(cell, input.ridgeSpineData?.saddle_nodes);
      cell.ridge = computeRidgeScore(
        cell,
        input.ridgeSpineData?.ridges_primary,
        input.ridgeSpineData?.ridges_secondary
      );

      // Apply season weights and combine
      const benchW = cell.bench * sw.bench * W_BENCH;
      const saddleW = cell.saddle * sw.saddle * W_SADDLE;
      const ridgeW = cell.ridge * sw.ridge * W_RIDGE;

      cell.pressure = benchW + saddleW + ridgeW;
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
  const features: GeoJSON.Feature[] = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];
      const raw = cell.pressure;

      // Apply focus mode floor
      if (raw < focus.scoreFloor) continue;

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
          source: 'raster',
        },
        geometry: {
          type: 'Point',
          coordinates: [cell.lng, cell.lat],
        },
      });
    }
  }

  // Extract opportunity zones from local maxima
  const opportunityZones = extractLocalMaxima(grid, 3);

  return {
    grid,
    heatPoints: { type: 'FeatureCollection', features },
    opportunityZones,
  };
}

// ============ LOCAL MAXIMA EXTRACTION ============

/**
 * Extract local maxima from the pressure surface.
 * These become opportunity zones (best stand site candidates).
 */
function extractLocalMaxima(grid: RasterGrid, maxCount: number): OpportunityZone[] {
  const candidates: { row: number; col: number; pressure: number }[] = [];

  // Find cells that are local maxima (higher than all 8 neighbors)
  for (let r = 1; r < grid.rows - 1; r++) {
    for (let c = 1; c < grid.cols - 1; c++) {
      const center = grid.cells[r][c].pressure;
      if (center < 0.25) continue; // minimum threshold for opportunity

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
        candidates.push({ row: r, col: c, pressure: center });
      }
    }
  }

  // Sort by pressure (highest first)
  candidates.sort((a, b) => b.pressure - a.pressure);

  // Deduplicate: keep only maxima that are far enough apart
  const MIN_SEPARATION_CELLS = 4; // ~60m at 15m cell size
  const selected: OpportunityZone[] = [];

  for (const cand of candidates) {
    if (selected.length >= maxCount) break;

    // Check distance from already-selected zones
    let tooClose = false;
    for (const sel of selected) {
      const cell = grid.cells[cand.row][cand.col];
      const dist = Math.sqrt(
        Math.pow(cell.lng - sel.lng, 2) + Math.pow(cell.lat - sel.lat, 2)
      );
      // Convert to approximate cell distance
      const cellDist = Math.sqrt(
        Math.pow(cand.row - (sel as any)._row, 2) +
        Math.pow(cand.col - (sel as any)._col, 2)
      );
      if (cellDist < MIN_SEPARATION_CELLS) {
        tooClose = true;
        break;
      }
    }

    if (!tooClose) {
      const cell = grid.cells[cand.row][cand.col];
      const zone: OpportunityZone & { _row: number; _col: number } = {
        lng: cell.lng,
        lat: cell.lat,
        score: cand.pressure,
        rank: selected.length + 1,
        _row: cand.row,
        _col: cand.col,
      };
      selected.push(zone);
    }
  }

  // Clean up internal tracking properties
  return selected.map(({ lng, lat, score, rank }) => ({ lng, lat, score, rank }));
}

/**
 * Convert opportunity zones to GeoJSON for map rendering.
 */
export function opportunityZonesToGeoJSON(
  zones: OpportunityZone[]
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones.map((z, i) => ({
      type: 'Feature' as const,
      properties: {
        id: `opp_raster_${i}`,
        score: z.score,
        rank: z.rank,
        flowIntensity: z.score,
        convergenceBonus: 0,
        benchBonus: z.score * 0.40,
        saddleBonus: z.score * 0.30,
        radiusM: 50,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [z.lng, z.lat],
      },
    })),
  };
}
