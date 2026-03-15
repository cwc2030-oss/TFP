/**
 * Terrain Huntability Engine v1.1 — Structural Signal Convergence
 * 
 * A comprehensive DEM-based terrain analysis system that computes:
 *   1. Travel Favorability Surface - where terrain facilitates movement
 *   2. Corridor Extraction - connected high-favorability paths
 *   3. Convergence Nodes - where STRUCTURAL SIGNALS overlap (not just pressure maxima)
 *   4. Huntability Score - overall parcel hunting quality
 * 
 * v1.1 Refinements (Convergence & Stand Placement):
 *   - Convergence requires 2+ structural signals (corridor intersection, saddle, draw, curvature, etc.)
 *   - Convergence is derived FROM corridors, not from favorability heatmap
 *   - Tighter search radius (2 cells) for compact convergence nodes
 *   - Reduced max nodes (6) for quality over quantity
 * 
 * The "Big Beautiful Map" renders:
 *   - Travel Corridors (primary movement spine, not "ridge")
 *   - Convergence Nodes (true pinch points, not pressure blankets)
 *   - Huntability Score badge
 * 
 * This is pure terrain physics, not wildlife AI.
 * "Where would terrain naturally COMPRESS movement?"
 */

import {
  TerrainGrid,
  createEmptyGrid,
  coordToCell,
  cellToCoord,
  distanceMeters as terrainDistanceMeters,
  getBbox,
  SLOPE_BANDS,
} from './terrain-analysis';

import {
  DEMGrid,
  createDEMFromSamples,
  computeSlopeAspect,
  computeCurvature,
  computeTrueSlopePreference,
  detectBenches,
  detectRidges,
  detectSaddles,
  detectDrainages,
  computeAllDEMComponents,
  type DEMComponentRasters,
  type TerrainFeaturePoint,
} from './dem-analysis';

// ========== CONFIGURATION ==========

// Grid resolution for huntability analysis
const HUNTABILITY_CELL_SIZE_M = 20; // 20m cells for balance of detail vs performance
const MIN_GRID_CELLS = 15;
const MAX_GRID_CELLS = 80;

// Travel favorability weights
const FAVORABILITY_WEIGHTS = {
  slope_preference: 0.30,     // Moderate slopes favored
  bench_likelihood: 0.25,     // Sidehill benches are travel lanes
  saddle_proximity: 0.20,     // Saddles are terrain crossings
  ridge_proximity: 0.15,      // Ridge-following movement
  drainage_penalty: -0.10,    // Avoid incised drainages
};

// Corridor extraction thresholds
const CORRIDOR_THRESHOLDS = {
  primary_percentile: 0.80,   // Top 20% = primary corridors
  secondary_percentile: 0.60, // Top 40% = secondary corridors
  min_length_cells: 5,        // Minimum 5 cells (~100m)
  max_gap_cells: 2,           // Allow 2-cell gaps in corridors
};

// Convergence detection — STRUCTURAL SIGNALS REQUIRED
// Convergence = true movement compression, NOT general terrain suitability
const CONVERGENCE_CONFIG = {
  search_radius_cells: 2,       // Tighter radius (was 3) — compact nodes only
  min_corridors: 2,             // Need at least 2 corridors converging
  min_structural_signals: 2,    // NEW: require 2+ overlapping structural signals
  min_intensity: 0.65,          // Slightly higher threshold
  max_nodes: 6,                 // Fewer nodes (was 8) — quality over quantity
  min_corridor_intersection_score: 0.5, // Actual corridor overlap required
};

// Structural signal thresholds for convergence qualification
const STRUCTURAL_THRESHOLDS = {
  corridor_intersection: 0.5,   // Multiple corridors within tight radius
  saddle_proximity_m: 60,       // Within 60m of a saddle
  draw_proximity_m: 80,         // Within 80m of drainage/draw
  terrain_curvature: 0.4,       // Concave terrain (pinch/funnel)
  corridor_narrowing: 0.3,      // Local corridor width contraction
  ridge_wrap: 0.5,              // Ridge bending/narrowing
};

// Huntability score component weights
const HUNTABILITY_WEIGHTS = {
  terrain_structure: 0.25,    // Ridge/saddle/bench diversity
  corridor_density: 0.25,     // Travel corridor coverage
  convergence_quality: 0.20,  // Quality of convergence nodes
  funnel_potential: 0.15,     // Natural pinch points
  access_variety: 0.15,       // Multiple approach angles
};

// ========== TYPES ==========

export interface HuntabilityInput {
  /** Parcel boundary coordinates [[lng, lat], ...] */
  parcelCoords: number[][];
  /** Optional elevation samples for DEM construction */
  elevationSamples?: Array<{ coord: [number, number]; elevation_m: number }>;
  /** Optional pre-computed ridge data */
  ridgeData?: {
    ridges_primary?: GeoJSON.FeatureCollection;
    ridges_secondary?: GeoJSON.FeatureCollection;
    saddle_nodes?: GeoJSON.FeatureCollection;
  } | null;
}

export interface HuntabilityCell {
  row: number;
  col: number;
  lng: number;
  lat: number;
  // Terrain components
  slope_pref: number;      // 0-1 slope preference
  bench: number;           // 0-1 bench likelihood
  saddle_prox: number;     // 0-1 saddle proximity
  ridge_prox: number;      // 0-1 ridge proximity
  drainage_pen: number;    // 0-1 drainage penalty
  // Computed favorability
  favorability: number;    // 0-1 travel favorability
  // Corridor membership
  corridorTier: 'primary' | 'secondary' | 'none';
  corridorId: number | null;
}

export interface HuntabilityGrid {
  cells: HuntabilityCell[][];
  rows: number;
  cols: number;
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  cellSizeM: number;
}

export interface Corridor {
  id: number;
  tier: 'primary' | 'secondary';
  cells: Array<{ row: number; col: number }>;
  coordinates: [number, number][];
  avgFavorability: number;
  lengthM: number;
}

export interface ConvergenceNode {
  id: number;
  lng: number;
  lat: number;
  corridorIds: number[];
  intensity: number;       // 0-1 convergence strength
  type: 'pinch' | 'hub' | 'saddle_crossing';
  radiusM: number;
}

export interface HuntabilityScore {
  overall: number;           // 0-100 overall score
  grade: 'A' | 'B' | 'C' | 'D' | 'F';  // Letter grade
  components: {
    terrain_structure: number;
    corridor_density: number;
    convergence_quality: number;
    funnel_potential: number;
    access_variety: number;
  };
  explanation: string;
}

export interface HuntabilityResult {
  grid: HuntabilityGrid;
  corridors: Corridor[];
  convergenceNodes: ConvergenceNode[];
  score: HuntabilityScore;
  // GeoJSON for map rendering
  favorabilitySurface: GeoJSON.FeatureCollection;
  corridorLines: GeoJSON.FeatureCollection;
  convergencePoints: GeoJSON.FeatureCollection;
  terrainSkeleton: {
    ridges: GeoJSON.FeatureCollection;
    saddles: GeoJSON.FeatureCollection;
  };
  metadata: {
    cellSizeM: number;
    gridDimensions: { rows: number; cols: number };
    corridorCount: { primary: number; secondary: number };
    convergenceCount: number;
    processingTimeMs: number;
    hasDEM: boolean;
  };
}

// ========== UTILITY FUNCTIONS ==========

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
function getPolygonCentroid(coords: number[][]): [number, number] {
  let sumLng = 0, sumLat = 0;
  for (const c of coords) {
    sumLng += c[0];
    sumLat += c[1];
  }
  return [sumLng / coords.length, sumLat / coords.length];
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

/** Compute inverse distance score (1 at source, 0 at radius) */
function proximityScore(dist: number, radius: number): number {
  if (dist >= radius) return 0;
  const t = dist / radius;
  return Math.max(0, 1 - t * t);
}

// ========== GRID GENERATION ==========

/**
 * Generate the huntability analysis grid covering the parcel.
 */
function generateHuntabilityGrid(parcelCoords: number[][]): HuntabilityGrid | null {
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

  // Add 10% buffer
  const bufferLng = (maxLng - minLng) * 0.10;
  const bufferLat = (maxLat - minLat) * 0.10;
  minLng -= bufferLng;
  maxLng += bufferLng;
  minLat -= bufferLat;
  maxLat += bufferLat;

  // Calculate grid dimensions
  const centerLat = (minLat + maxLat) / 2;
  const mpd = metersPerDegree(centerLat);
  const widthM = (maxLng - minLng) * mpd.lng;
  const heightM = (maxLat - minLat) * mpd.lat;

  let cols = Math.round(widthM / HUNTABILITY_CELL_SIZE_M);
  let rows = Math.round(heightM / HUNTABILITY_CELL_SIZE_M);
  cols = Math.max(MIN_GRID_CELLS, Math.min(MAX_GRID_CELLS, cols));
  rows = Math.max(MIN_GRID_CELLS, Math.min(MAX_GRID_CELLS, rows));

  // Generate empty cells
  const cellWidthDeg = (maxLng - minLng) / cols;
  const cellHeightDeg = (maxLat - minLat) / rows;

  const cells: HuntabilityCell[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: HuntabilityCell[] = [];
    for (let c = 0; c < cols; c++) {
      const lng = minLng + (c + 0.5) * cellWidthDeg;
      const lat = minLat + (r + 0.5) * cellHeightDeg;
      row.push({
        row: r,
        col: c,
        lng,
        lat,
        slope_pref: 0,
        bench: 0,
        saddle_prox: 0,
        ridge_prox: 0,
        drainage_pen: 0,
        favorability: 0,
        corridorTier: 'none',
        corridorId: null,
      });
    }
    cells.push(row);
  }

  return {
    cells,
    rows,
    cols,
    bounds: { minLng, maxLng, minLat, maxLat },
    cellSizeM: HUNTABILITY_CELL_SIZE_M,
  };
}

// ========== TERRAIN COMPONENT SCORING ==========

/**
 * Compute ridge proximity score for each cell.
 */
function computeRidgeProximity(
  grid: HuntabilityGrid,
  ridgesPrimary?: GeoJSON.FeatureCollection,
  ridgesSecondary?: GeoJSON.FeatureCollection
): void {
  const RIDGE_INFLUENCE_M = 80;

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];
      const cellCoord: [number, number] = [cell.lng, cell.lat];
      let maxScore = 0;

      // Primary ridges (weight 1.0)
      if (ridgesPrimary?.features?.length) {
        for (const f of ridgesPrimary.features) {
          if (f.geometry?.type !== 'LineString') continue;
          const coords = f.geometry.coordinates;
          const points = sampleLinePoints(coords, 12);
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
          if (f.geometry?.type !== 'LineString') continue;
          const coords = f.geometry.coordinates;
          const points = sampleLinePoints(coords, 10);
          for (const pt of points) {
            const dist = distanceMeters(cellCoord, pt);
            const prox = proximityScore(dist, RIDGE_INFLUENCE_M * 0.8);
            maxScore = Math.max(maxScore, prox * 0.6);
          }
        }
      }

      cell.ridge_prox = Math.min(1, maxScore);
    }
  }
}

/**
 * Compute saddle proximity score for each cell.
 */
function computeSaddleProximity(
  grid: HuntabilityGrid,
  saddleNodes?: GeoJSON.FeatureCollection
): void {
  const SADDLE_INFLUENCE_M = 120;

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];
      if (!saddleNodes?.features?.length) {
        cell.saddle_prox = 0;
        continue;
      }

      const cellCoord: [number, number] = [cell.lng, cell.lat];
      let maxScore = 0;

      for (const f of saddleNodes.features) {
        if (f.geometry?.type !== 'Point') continue;
        const coord = f.geometry.coordinates as [number, number];
        const dist = distanceMeters(cellCoord, coord);
        const prox = proximityScore(dist, SADDLE_INFLUENCE_M);
        const prominence = (f.properties?.prominence as number) || 0.7;
        const score = prox * Math.min(1, prominence);
        maxScore = Math.max(maxScore, score);
      }

      cell.saddle_prox = Math.min(1, maxScore);
    }
  }
}

/**
 * Compute bench likelihood for each cell (synthetic based on grid gradients).
 */
function computeBenchLikelihood(grid: HuntabilityGrid): void {
  // Use grid gradient as terrain structure proxy
  for (let r = 1; r < grid.rows - 1; r++) {
    for (let c = 1; c < grid.cols - 1; c++) {
      const cell = grid.cells[r][c];
      
      // Compute local gradient from ridge proximity (as elevation proxy)
      const ridgeN = grid.cells[r - 1][c].ridge_prox;
      const ridgeS = grid.cells[r + 1][c].ridge_prox;
      const ridgeE = grid.cells[r][c + 1].ridge_prox;
      const ridgeW = grid.cells[r][c - 1].ridge_prox;
      
      const gradLat = (ridgeN - ridgeS) / 2;
      const gradLng = (ridgeE - ridgeW) / 2;
      const gradMag = Math.sqrt(gradLat * gradLat + gradLng * gradLng);
      
      // Bench = moderate gradient (not flat, not steep) + not on ridge crest
      let benchScore = 0;
      
      // Moderate gradient favors benches (0.1-0.3 is sweet spot)
      if (gradMag >= 0.08 && gradMag <= 0.35) {
        benchScore = 0.6;
        if (gradMag >= 0.12 && gradMag <= 0.25) {
          benchScore = 0.9; // Optimal
        }
      } else if (gradMag < 0.08) {
        benchScore = 0.3; // Too flat
      } else {
        benchScore = 0.2; // Too steep
      }
      
      // Not on ridge crest (ridge_prox < 0.8)
      if (cell.ridge_prox > 0.8) {
        benchScore *= 0.3; // Heavily penalize ridge crests
      } else if (cell.ridge_prox > 0.5 && cell.ridge_prox <= 0.8) {
        benchScore *= 1.2; // Boost ridge shoulders
        benchScore = Math.min(1, benchScore);
      }
      
      cell.bench = benchScore;
    }
  }
  
  // Handle edge cells
  for (let r = 0; r < grid.rows; r++) {
    grid.cells[r][0].bench = grid.cells[r][1]?.bench || 0.3;
    grid.cells[r][grid.cols - 1].bench = grid.cells[r][grid.cols - 2]?.bench || 0.3;
  }
  for (let c = 0; c < grid.cols; c++) {
    grid.cells[0][c].bench = grid.cells[1]?.[c]?.bench || 0.3;
    grid.cells[grid.rows - 1][c].bench = grid.cells[grid.rows - 2]?.[c]?.bench || 0.3;
  }
}

/**
 * Compute slope preference for each cell (synthetic).
 */
function computeSlopePreference(grid: HuntabilityGrid): void {
  for (let r = 1; r < grid.rows - 1; r++) {
    for (let c = 1; c < grid.cols - 1; c++) {
      const cell = grid.cells[r][c];
      
      // Use ridge gradient as slope proxy
      const ridgeN = grid.cells[r - 1][c].ridge_prox;
      const ridgeS = grid.cells[r + 1][c].ridge_prox;
      const ridgeE = grid.cells[r][c + 1].ridge_prox;
      const ridgeW = grid.cells[r][c - 1].ridge_prox;
      
      const gradLat = Math.abs(ridgeN - ridgeS);
      const gradLng = Math.abs(ridgeE - ridgeW);
      const slopeProxy = (gradLat + gradLng) / 2;
      
      // Optimal: moderate slope (0.1-0.2)
      let slopePref = 0.5;
      if (slopeProxy >= 0.08 && slopeProxy <= 0.25) {
        slopePref = 0.9; // Optimal for travel
      } else if (slopeProxy < 0.05) {
        slopePref = 0.4; // Too flat
      } else if (slopeProxy > 0.4) {
        slopePref = 0.2; // Too steep
      } else {
        slopePref = 0.6; // Acceptable
      }
      
      cell.slope_pref = slopePref;
    }
  }
  
  // Edge cells
  for (let r = 0; r < grid.rows; r++) {
    grid.cells[r][0].slope_pref = 0.5;
    grid.cells[r][grid.cols - 1].slope_pref = 0.5;
  }
  for (let c = 0; c < grid.cols; c++) {
    grid.cells[0][c].slope_pref = 0.5;
    grid.cells[grid.rows - 1][c].slope_pref = 0.5;
  }
}

/**
 * Compute drainage penalty (areas to avoid).
 */
function computeDrainagePenalty(grid: HuntabilityGrid): void {
  // Drainages are low ridge proximity areas with convergent terrain
  for (let r = 1; r < grid.rows - 1; r++) {
    for (let c = 1; c < grid.cols - 1; c++) {
      const cell = grid.cells[r][c];
      
      // Low ridge proximity = valley/drainage
      let drainagePen = 0;
      
      // Very low ridge proximity indicates drainage
      if (cell.ridge_prox < 0.1 && cell.bench < 0.3) {
        drainagePen = 0.7; // Strong drainage
      } else if (cell.ridge_prox < 0.2 && cell.bench < 0.4) {
        drainagePen = 0.4; // Moderate drainage
      } else if (cell.ridge_prox < 0.3) {
        drainagePen = 0.2; // Minor drainage
      }
      
      cell.drainage_pen = drainagePen;
    }
  }
}

// ========== FAVORABILITY SURFACE ==========

/**
 * Compute the travel favorability surface by combining terrain components.
 */
function computeFavorabilitySurface(grid: HuntabilityGrid): void {
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];
      
      // Weighted combination
      let favorability = 
        cell.slope_pref * FAVORABILITY_WEIGHTS.slope_preference +
        cell.bench * FAVORABILITY_WEIGHTS.bench_likelihood +
        cell.saddle_prox * FAVORABILITY_WEIGHTS.saddle_proximity +
        cell.ridge_prox * FAVORABILITY_WEIGHTS.ridge_proximity +
        cell.drainage_pen * FAVORABILITY_WEIGHTS.drainage_penalty; // Negative weight
      
      // Clamp to 0-1
      cell.favorability = Math.max(0, Math.min(1, favorability));
    }
  }
  
  // Apply light Gaussian smoothing for natural transitions
  applyGaussianSmoothing(grid);
  
  // Re-normalize after smoothing
  let maxFav = 0;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      maxFav = Math.max(maxFav, grid.cells[r][c].favorability);
    }
  }
  if (maxFav > 0) {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        grid.cells[r][c].favorability /= maxFav;
      }
    }
  }
}

/**
 * Apply Gaussian smoothing to favorability surface.
 */
function applyGaussianSmoothing(grid: HuntabilityGrid): void {
  const kernel = [
    [0.0625, 0.125, 0.0625],
    [0.125,  0.25,  0.125],
    [0.0625, 0.125, 0.0625],
  ];

  const original: number[][] = [];
  for (let r = 0; r < grid.rows; r++) {
    original.push(grid.cells[r].map(c => c.favorability));
  }

  for (let r = 1; r < grid.rows - 1; r++) {
    for (let c = 1; c < grid.cols - 1; c++) {
      let sum = 0;
      for (let kr = -1; kr <= 1; kr++) {
        for (let kc = -1; kc <= 1; kc++) {
          sum += original[r + kr][c + kc] * kernel[kr + 1][kc + 1];
        }
      }
      grid.cells[r][c].favorability = sum;
    }
  }
}

// ========== CORRIDOR EXTRACTION ==========

/**
 * Extract travel corridors from the favorability surface.
 * Uses connected component analysis on high-favorability cells.
 */
function extractCorridors(grid: HuntabilityGrid): Corridor[] {
  // Compute percentile thresholds
  const allFavorabilities: number[] = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      allFavorabilities.push(grid.cells[r][c].favorability);
    }
  }
  allFavorabilities.sort((a, b) => a - b);
  
  const primaryIdx = Math.floor(allFavorabilities.length * CORRIDOR_THRESHOLDS.primary_percentile);
  const secondaryIdx = Math.floor(allFavorabilities.length * CORRIDOR_THRESHOLDS.secondary_percentile);
  const primaryThreshold = allFavorabilities[primaryIdx] || 0.7;
  const secondaryThreshold = allFavorabilities[secondaryIdx] || 0.5;
  
  // Mark cells by tier
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];
      if (cell.favorability >= primaryThreshold) {
        cell.corridorTier = 'primary';
      } else if (cell.favorability >= secondaryThreshold) {
        cell.corridorTier = 'secondary';
      }
    }
  }
  
  // Connected component labeling for corridors
  const corridors: Corridor[] = [];
  const visited: boolean[][] = Array(grid.rows).fill(null).map(() => Array(grid.cols).fill(false));
  let corridorId = 0;
  
  // Extract primary corridors first
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (visited[r][c] || grid.cells[r][c].corridorTier !== 'primary') continue;
      
      const cells: Array<{ row: number; col: number }> = [];
      const stack: Array<[number, number]> = [[r, c]];
      
      while (stack.length > 0) {
        const [cr, cc] = stack.pop()!;
        if (visited[cr][cc]) continue;
        if (grid.cells[cr][cc].corridorTier !== 'primary') continue;
        
        visited[cr][cc] = true;
        cells.push({ row: cr, col: cc });
        grid.cells[cr][cc].corridorId = corridorId;
        
        // Check 8-connected neighbors
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = cr + dr;
            const nc = cc + dc;
            if (nr >= 0 && nr < grid.rows && nc >= 0 && nc < grid.cols && !visited[nr][nc]) {
              stack.push([nr, nc]);
            }
          }
        }
      }
      
      if (cells.length >= CORRIDOR_THRESHOLDS.min_length_cells) {
        const corridor = buildCorridor(grid, cells, corridorId, 'primary');
        corridors.push(corridor);
        corridorId++;
      }
    }
  }
  
  // Extract secondary corridors
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (visited[r][c] || grid.cells[r][c].corridorTier !== 'secondary') continue;
      
      const cells: Array<{ row: number; col: number }> = [];
      const stack: Array<[number, number]> = [[r, c]];
      
      while (stack.length > 0) {
        const [cr, cc] = stack.pop()!;
        if (visited[cr][cc]) continue;
        if (grid.cells[cr][cc].corridorTier !== 'secondary') continue;
        
        visited[cr][cc] = true;
        cells.push({ row: cr, col: cc });
        grid.cells[cr][cc].corridorId = corridorId;
        
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = cr + dr;
            const nc = cc + dc;
            if (nr >= 0 && nr < grid.rows && nc >= 0 && nc < grid.cols && !visited[nr][nc]) {
              stack.push([nr, nc]);
            }
          }
        }
      }
      
      if (cells.length >= CORRIDOR_THRESHOLDS.min_length_cells) {
        const corridor = buildCorridor(grid, cells, corridorId, 'secondary');
        corridors.push(corridor);
        corridorId++;
      }
    }
  }
  
  return corridors;
}

/**
 * Build a corridor from a set of cells.
 */
function buildCorridor(
  grid: HuntabilityGrid,
  cells: Array<{ row: number; col: number }>,
  id: number,
  tier: 'primary' | 'secondary'
): Corridor {
  // Order cells by connectivity to create a path
  const coordinates: [number, number][] = [];
  let totalFav = 0;
  
  // Simple centroid-based ordering
  for (const c of cells) {
    const cell = grid.cells[c.row][c.col];
    coordinates.push([cell.lng, cell.lat]);
    totalFav += cell.favorability;
  }
  
  // Estimate length
  let lengthM = 0;
  for (let i = 1; i < coordinates.length; i++) {
    lengthM += distanceMeters(coordinates[i - 1], coordinates[i]);
  }
  
  return {
    id,
    tier,
    cells,
    coordinates,
    avgFavorability: totalFav / cells.length,
    lengthM,
  };
}

// ========== CONVERGENCE DETECTION (STRUCTURAL SIGNAL APPROACH) ==========

/**
 * Structural signal scores for a convergence candidate.
 * Convergence requires at least 2 overlapping structural signals.
 */
interface StructuralSignals {
  corridorIntersection: number;  // Multiple corridors within tight radius
  saddleProximity: number;       // Near a saddle point
  drawProximity: number;         // Near a draw/drainage
  terrainCurvature: number;      // Concave terrain (natural funnel)
  corridorNarrowing: number;     // Local corridor width contraction
  ridgeWrap: number;             // Ridge bending creates pinch
  signalCount: number;           // How many signals exceed threshold
}

/**
 * Compute structural signals for a candidate convergence point.
 * Returns individual signal scores and count of qualifying signals.
 */
function computeStructuralSignals(
  row: number,
  col: number,
  grid: HuntabilityGrid,
  corridors: Corridor[],
  corridorMap: Map<string, Set<number>>,
  saddleNodes?: GeoJSON.FeatureCollection
): StructuralSignals {
  const searchRadius = CONVERGENCE_CONFIG.search_radius_cells;
  const cell = grid.cells[row][col];
  const cellCoord: [number, number] = [cell.lng, cell.lat];
  
  // Signal 1: Corridor intersection (multiple distinct corridors in tight area)
  const nearbyCorridors = new Set<number>();
  for (let dr = -searchRadius; dr <= searchRadius; dr++) {
    for (let dc = -searchRadius; dc <= searchRadius; dc++) {
      const key = `${row + dr},${col + dc}`;
      if (corridorMap.has(key)) {
        for (const cid of corridorMap.get(key)!) {
          nearbyCorridors.add(cid);
        }
      }
    }
  }
  // Score based on corridor count (2=base, more=better)
  const corridorIntersection = nearbyCorridors.size >= 2 
    ? Math.min(1, 0.5 + (nearbyCorridors.size - 2) * 0.25)
    : 0;
  
  // Signal 2: Saddle proximity (actual saddle within threshold distance)
  let saddleProximity = 0;
  if (saddleNodes?.features?.length) {
    for (const f of saddleNodes.features) {
      if (f.geometry?.type !== 'Point') continue;
      const saddleCoord = f.geometry.coordinates as [number, number];
      const dist = distanceMeters(cellCoord, saddleCoord);
      if (dist < STRUCTURAL_THRESHOLDS.saddle_proximity_m) {
        const prox = 1 - (dist / STRUCTURAL_THRESHOLDS.saddle_proximity_m);
        saddleProximity = Math.max(saddleProximity, prox);
      }
    }
  }
  
  // Signal 3: Draw/drainage proximity (low ridge areas with drainage penalty)
  let drawProximity = 0;
  // Check nearby cells for drainage characteristics
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= grid.rows || nc < 0 || nc >= grid.cols) continue;
      const nearCell = grid.cells[nr][nc];
      // Draw = low ridge proximity + drainage penalty
      if (nearCell.drainage_pen > 0.4 && nearCell.ridge_prox < 0.3) {
        const dist = Math.sqrt(dr * dr + dc * dc);
        const contribution = nearCell.drainage_pen * (1 - dist / 3);
        drawProximity = Math.max(drawProximity, contribution);
      }
    }
  }
  
  // Signal 4: Terrain curvature (concave terrain = funnel/pinch)
  let terrainCurvature = 0;
  if (row >= 2 && row < grid.rows - 2 && col >= 2 && col < grid.cols - 2) {
    // Laplacian approximation for curvature using favorability as proxy
    const center = cell.favorability;
    const neighbors = [
      grid.cells[row-1][col].favorability,
      grid.cells[row+1][col].favorability,
      grid.cells[row][col-1].favorability,
      grid.cells[row][col+1].favorability,
    ];
    const avgNeighbor = neighbors.reduce((a, b) => a + b, 0) / 4;
    // Concave = center higher than average neighbors (funneling toward center)
    const laplacian = center - avgNeighbor;
    if (laplacian > 0) {
      terrainCurvature = Math.min(1, laplacian * 4);
    }
  }
  
  // Signal 5: Corridor narrowing (width contraction near this point)
  let corridorNarrowing = 0;
  // Count corridor cells in concentric rings and check for narrowing
  const innerCells = countCorridorCellsInRing(row, col, 0, 1, corridorMap);
  const outerCells = countCorridorCellsInRing(row, col, 2, 3, corridorMap);
  if (outerCells > innerCells && innerCells > 0) {
    // More corridor cells in outer ring than inner = narrowing toward center
    corridorNarrowing = Math.min(1, (outerCells - innerCells) / 6);
  }
  
  // Signal 6: Ridge wrap (ridge bending creates natural pinch)
  let ridgeWrap = 0;
  // Check if ridge proximity varies significantly around the cell (indicates curve)
  if (row >= 2 && row < grid.rows - 2 && col >= 2 && col < grid.cols - 2) {
    const ridgeValues = [
      grid.cells[row-2][col].ridge_prox,
      grid.cells[row+2][col].ridge_prox,
      grid.cells[row][col-2].ridge_prox,
      grid.cells[row][col+2].ridge_prox,
    ];
    const maxRidge = Math.max(...ridgeValues);
    const minRidge = Math.min(...ridgeValues);
    // High variance in ridge proximity = ridge is bending
    if (maxRidge > 0.5 && (maxRidge - minRidge) > 0.3) {
      ridgeWrap = Math.min(1, (maxRidge - minRidge) * 1.5);
    }
  }
  
  // Count signals exceeding thresholds
  let signalCount = 0;
  if (corridorIntersection >= STRUCTURAL_THRESHOLDS.corridor_intersection) signalCount++;
  if (saddleProximity >= 0.4) signalCount++;  // 40% saddle proximity
  if (drawProximity >= 0.3) signalCount++;    // 30% draw proximity
  if (terrainCurvature >= STRUCTURAL_THRESHOLDS.terrain_curvature) signalCount++;
  if (corridorNarrowing >= STRUCTURAL_THRESHOLDS.corridor_narrowing) signalCount++;
  if (ridgeWrap >= STRUCTURAL_THRESHOLDS.ridge_wrap) signalCount++;
  
  return {
    corridorIntersection,
    saddleProximity,
    drawProximity,
    terrainCurvature,
    corridorNarrowing,
    ridgeWrap,
    signalCount,
  };
}

/** Helper: count corridor cells in a ring between minDist and maxDist */
function countCorridorCellsInRing(
  centerRow: number,
  centerCol: number,
  minDist: number,
  maxDist: number,
  corridorMap: Map<string, Set<number>>
): number {
  let count = 0;
  for (let dr = -maxDist; dr <= maxDist; dr++) {
    for (let dc = -maxDist; dc <= maxDist; dc++) {
      const dist = Math.sqrt(dr * dr + dc * dc);
      if (dist >= minDist && dist <= maxDist) {
        const key = `${centerRow + dr},${centerCol + dc}`;
        if (corridorMap.has(key) && corridorMap.get(key)!.size > 0) {
          count++;
        }
      }
    }
  }
  return count;
}

/**
 * Detect convergence nodes using STRUCTURAL SIGNAL approach.
 * 
 * Key principles:
 * 1. Convergence must have 2+ structural signals (not just high favorability)
 * 2. Corridor intersection is required (convergence is corridor-derived)
 * 3. Nodes are compact (small search radius) and well-separated
 * 4. Types determined by dominant structural signal
 */
function detectConvergenceNodes(
  grid: HuntabilityGrid,
  corridors: Corridor[],
  saddleNodes?: GeoJSON.FeatureCollection
): ConvergenceNode[] {
  const nodes: ConvergenceNode[] = [];
  const searchRadius = CONVERGENCE_CONFIG.search_radius_cells;
  
  // Build corridor cell lookup
  const corridorMap = new Map<string, Set<number>>();
  for (const corridor of corridors) {
    for (const cell of corridor.cells) {
      const key = `${cell.row},${cell.col}`;
      if (!corridorMap.has(key)) {
        corridorMap.set(key, new Set());
      }
      corridorMap.get(key)!.add(corridor.id);
    }
  }
  
  // Phase 1: Find candidates that have corridor presence
  const convergenceCandidates: Array<{
    row: number;
    col: number;
    signals: StructuralSignals;
    corridorIds: Set<number>;
    compositeScore: number;
  }> = [];
  
  for (let r = searchRadius; r < grid.rows - searchRadius; r++) {
    for (let c = searchRadius; c < grid.cols - searchRadius; c++) {
      // Only consider cells that are ON or immediately adjacent to corridors
      const cellKey = `${r},${c}`;
      const isOnCorridor = corridorMap.has(cellKey);
      const isAdjacentToCorridor = !isOnCorridor && (
        corridorMap.has(`${r-1},${c}`) || corridorMap.has(`${r+1},${c}`) ||
        corridorMap.has(`${r},${c-1}`) || corridorMap.has(`${r},${c+1}`)
      );
      
      if (!isOnCorridor && !isAdjacentToCorridor) continue;
      
      // Compute structural signals
      const signals = computeStructuralSignals(
        r, c, grid, corridors, corridorMap, saddleNodes
      );
      
      // REQUIRE: corridor intersection + at least 1 other structural signal
      if (signals.corridorIntersection < CONVERGENCE_CONFIG.min_corridor_intersection_score) continue;
      if (signals.signalCount < CONVERGENCE_CONFIG.min_structural_signals) continue;
      
      // Collect corridor IDs for this candidate
      const nearbyCorridors = new Set<number>();
      for (let dr = -searchRadius; dr <= searchRadius; dr++) {
        for (let dc = -searchRadius; dc <= searchRadius; dc++) {
          const key = `${r + dr},${c + dc}`;
          if (corridorMap.has(key)) {
            for (const cid of corridorMap.get(key)!) {
              nearbyCorridors.add(cid);
            }
          }
        }
      }
      
      // Composite score: weighted combination of signals
      const compositeScore = 
        signals.corridorIntersection * 0.35 +
        signals.saddleProximity * 0.25 +
        signals.drawProximity * 0.15 +
        signals.terrainCurvature * 0.10 +
        signals.corridorNarrowing * 0.10 +
        signals.ridgeWrap * 0.05;
      
      if (compositeScore >= CONVERGENCE_CONFIG.min_intensity) {
        convergenceCandidates.push({
          row: r,
          col: c,
          signals,
          corridorIds: nearbyCorridors,
          compositeScore,
        });
      }
    }
  }
  
  // Phase 2: Sort by composite score and select with spatial separation
  convergenceCandidates.sort((a, b) => b.compositeScore - a.compositeScore);
  
  const MIN_SEPARATION = 5; // cells (~100m at 20m cell size) — tighter nodes
  let nodeId = 0;
  
  for (const candidate of convergenceCandidates) {
    if (nodes.length >= CONVERGENCE_CONFIG.max_nodes) break;
    
    // Check distance to existing nodes
    let tooClose = false;
    for (const existing of nodes) {
      // Find existing node's approximate cell position
      const existingRow = Math.round((existing.lat - grid.bounds.minLat) / 
        ((grid.bounds.maxLat - grid.bounds.minLat) / grid.rows));
      const existingCol = Math.round((existing.lng - grid.bounds.minLng) / 
        ((grid.bounds.maxLng - grid.bounds.minLng) / grid.cols));
      
      const dist = Math.sqrt(
        Math.pow(candidate.row - existingRow, 2) + 
        Math.pow(candidate.col - existingCol, 2)
      );
      if (dist < MIN_SEPARATION) {
        tooClose = true;
        break;
      }
    }
    
    if (!tooClose) {
      const cell = grid.cells[candidate.row][candidate.col];
      const signals = candidate.signals;
      
      // Determine convergence type based on dominant structural signal
      let type: ConvergenceNode['type'];
      if (signals.saddleProximity >= 0.5) {
        type = 'saddle_crossing';
      } else if (signals.corridorNarrowing >= 0.4 || signals.terrainCurvature >= 0.5) {
        type = 'pinch';
      } else {
        type = 'hub';
      }
      
      // Smaller radius for tighter, more precise convergence nodes
      const radiusM = 20 + Math.min(20, candidate.corridorIds.size * 5);
      
      nodes.push({
        id: nodeId++,
        lng: cell.lng,
        lat: cell.lat,
        corridorIds: Array.from(candidate.corridorIds),
        intensity: Math.min(1, candidate.compositeScore),
        type,
        radiusM,
      });
    }
  }
  
  return nodes;
}

// ========== HUNTABILITY SCORE COMPUTATION ==========

/**
 * Compute the overall huntability score for the parcel.
 */
function computeHuntabilityScore(
  grid: HuntabilityGrid,
  corridors: Corridor[],
  convergenceNodes: ConvergenceNode[],
  ridgeData?: HuntabilityInput['ridgeData']
): HuntabilityScore {
  // Component 1: Terrain Structure (ridge/saddle/bench diversity)
  let terrainStructure = 0;
  const ridgeCount = ridgeData?.ridges_primary?.features?.length || 0;
  const saddleCount = ridgeData?.saddle_nodes?.features?.length || 0;
  let benchCount = 0;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (grid.cells[r][c].bench > 0.6) benchCount++;
    }
  }
  
  // Score based on feature counts (scaled to parcel size)
  const totalCells = grid.rows * grid.cols;
  terrainStructure = Math.min(100, 
    (ridgeCount * 15) + 
    (saddleCount * 20) + 
    ((benchCount / totalCells) * 300)
  );
  
  // Component 2: Corridor Density
  const primaryCorridors = corridors.filter(c => c.tier === 'primary').length;
  const secondaryCorridors = corridors.filter(c => c.tier === 'secondary').length;
  const totalCorridorCells = corridors.reduce((sum, c) => sum + c.cells.length, 0);
  const corridorDensity = Math.min(100, 
    (primaryCorridors * 20) + 
    (secondaryCorridors * 10) +
    ((totalCorridorCells / totalCells) * 150)
  );
  
  // Component 3: Convergence Quality
  let convergenceQuality = 0;
  if (convergenceNodes.length > 0) {
    const avgIntensity = convergenceNodes.reduce((sum, n) => sum + n.intensity, 0) / convergenceNodes.length;
    const pinchCount = convergenceNodes.filter(n => n.type === 'pinch').length;
    const hubCount = convergenceNodes.filter(n => n.type === 'hub').length;
    const saddleCount2 = convergenceNodes.filter(n => n.type === 'saddle_crossing').length;
    
    convergenceQuality = Math.min(100,
      (convergenceNodes.length * 12) +
      (avgIntensity * 40) +
      (pinchCount * 15) +
      (hubCount * 10) +
      (saddleCount2 * 20)
    );
  }
  
  // Component 4: Funnel Potential (narrow pinch points)
  let funnelPotential = 0;
  const pinchNodes = convergenceNodes.filter(n => n.type === 'pinch' || n.intensity > 0.8);
  funnelPotential = Math.min(100, pinchNodes.length * 25 + (pinchNodes.length > 0 ? 30 : 0));
  
  // Component 5: Access Variety (multiple approach angles)
  let accessVariety = 0;
  if (corridors.length >= 2) {
    // Simple angle diversity based on corridor orientations
    const angles: number[] = [];
    for (const corridor of corridors.slice(0, 6)) {
      if (corridor.coordinates.length >= 2) {
        const start = corridor.coordinates[0];
        const end = corridor.coordinates[corridor.coordinates.length - 1];
        const angle = Math.atan2(end[1] - start[1], end[0] - start[0]) * 180 / Math.PI;
        angles.push(angle);
      }
    }
    
    // Check angle diversity
    angles.sort((a, b) => a - b);
    let totalSpread = 0;
    for (let i = 1; i < angles.length; i++) {
      totalSpread += Math.abs(angles[i] - angles[i - 1]);
    }
    accessVariety = Math.min(100, (totalSpread / 180) * 60 + (angles.length * 10));
  }
  
  // Weighted overall score
  const overall = 
    terrainStructure * HUNTABILITY_WEIGHTS.terrain_structure +
    corridorDensity * HUNTABILITY_WEIGHTS.corridor_density +
    convergenceQuality * HUNTABILITY_WEIGHTS.convergence_quality +
    funnelPotential * HUNTABILITY_WEIGHTS.funnel_potential +
    accessVariety * HUNTABILITY_WEIGHTS.access_variety;
  
  // Convert to grade
  let grade: HuntabilityScore['grade'];
  if (overall >= 80) grade = 'A';
  else if (overall >= 65) grade = 'B';
  else if (overall >= 50) grade = 'C';
  else if (overall >= 35) grade = 'D';
  else grade = 'F';
  
  // Generate explanation
  const explanationParts: string[] = [];
  if (terrainStructure > 60) explanationParts.push('Strong terrain structure');
  if (corridorDensity > 60) explanationParts.push('Good travel corridor network');
  if (convergenceQuality > 60) explanationParts.push('Quality convergence zones');
  if (funnelPotential > 60) explanationParts.push('Natural funnel points');
  if (accessVariety > 60) explanationParts.push('Multiple approach options');
  
  const explanation = explanationParts.length > 0 
    ? explanationParts.join(', ')
    : 'Limited terrain features detected';
  
  return {
    overall: Math.round(overall),
    grade,
    components: {
      terrain_structure: Math.round(terrainStructure),
      corridor_density: Math.round(corridorDensity),
      convergence_quality: Math.round(convergenceQuality),
      funnel_potential: Math.round(funnelPotential),
      access_variety: Math.round(accessVariety),
    },
    explanation,
  };
}

// ========== GEOJSON CONVERSION ==========

/**
 * Convert favorability grid to GeoJSON point cloud for heatmap rendering.
 */
function gridToFavorabilityGeoJSON(grid: HuntabilityGrid): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];
      if (cell.favorability < 0.1) continue; // Skip very low values
      
      features.push({
        type: 'Feature',
        properties: {
          favorability: cell.favorability,
          intensity: cell.favorability,
          slope_pref: cell.slope_pref,
          bench: cell.bench,
          saddle_prox: cell.saddle_prox,
          ridge_prox: cell.ridge_prox,
          corridorTier: cell.corridorTier,
        },
        geometry: {
          type: 'Point',
          coordinates: [cell.lng, cell.lat],
        },
      });
    }
  }
  
  return { type: 'FeatureCollection', features };
}

/**
 * Convert corridors to GeoJSON LineStrings.
 */
function corridorsToGeoJSON(corridors: Corridor[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  
  for (const corridor of corridors) {
    // Create a simplified line through corridor cells
    if (corridor.coordinates.length < 2) continue;
    
    // Sort coordinates to create a reasonable path
    const sorted = simplifyCorridorPath(corridor.coordinates);
    if (sorted.length < 2) continue;
    
    features.push({
      type: 'Feature',
      properties: {
        id: `corridor_${corridor.id}`,
        tier: corridor.tier,
        likelihood: corridor.avgFavorability,
        lengthM: corridor.lengthM,
      },
      geometry: {
        type: 'LineString',
        coordinates: sorted,
      },
    });
  }
  
  return { type: 'FeatureCollection', features };
}

/**
 * Simplify corridor path to a cleaner line.
 */
function simplifyCorridorPath(coords: [number, number][]): [number, number][] {
  if (coords.length <= 3) return coords;
  
  // Find centroid
  let sumLng = 0, sumLat = 0;
  for (const c of coords) {
    sumLng += c[0];
    sumLat += c[1];
  }
  const centroid: [number, number] = [sumLng / coords.length, sumLat / coords.length];
  
  // Sort by angle from centroid to create a continuous path
  const sorted = [...coords].sort((a, b) => {
    const angleA = Math.atan2(a[1] - centroid[1], a[0] - centroid[0]);
    const angleB = Math.atan2(b[1] - centroid[1], b[0] - centroid[0]);
    return angleA - angleB;
  });
  
  // Simplify by taking every Nth point
  const simplified: [number, number][] = [];
  const step = Math.max(1, Math.floor(sorted.length / 12));
  for (let i = 0; i < sorted.length; i += step) {
    simplified.push(sorted[i]);
  }
  
  return simplified;
}

/**
 * Convert convergence nodes to GeoJSON Points.
 */
function convergenceNodesToGeoJSON(nodes: ConvergenceNode[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = nodes.map(node => ({
    type: 'Feature' as const,
    properties: {
      id: `convergence_${node.id}`,
      intensity: node.intensity,
      corridorCount: node.corridorIds.length,
      type: node.type,
      radiusM: node.radiusM,
    },
    geometry: {
      type: 'Point' as const,
      coordinates: [node.lng, node.lat],
    },
  }));
  
  return { type: 'FeatureCollection', features };
}

// ========== MAIN ENGINE ==========

/**
 * Build the complete Terrain Huntability analysis.
 * 
 * This is the main entry point for the v1 Huntability Engine.
 */
export function buildTerrainHuntability(input: HuntabilityInput): HuntabilityResult | null {
  const startTime = Date.now();
  
  // Generate analysis grid
  const grid = generateHuntabilityGrid(input.parcelCoords);
  if (!grid) {
    console.error('[Huntability] Failed to generate grid');
    return null;
  }
  
  console.log('[Huntability] Grid generated:', { rows: grid.rows, cols: grid.cols });
  
  // Step 1: Compute terrain components
  // First compute ridge proximity (used by other components)
  computeRidgeProximity(
    grid,
    input.ridgeData?.ridges_primary,
    input.ridgeData?.ridges_secondary
  );
  
  computeSaddleProximity(grid, input.ridgeData?.saddle_nodes);
  computeBenchLikelihood(grid);
  computeSlopePreference(grid);
  computeDrainagePenalty(grid);
  
  console.log('[Huntability] Terrain components computed');
  
  // Step 2: Build travel favorability surface
  computeFavorabilitySurface(grid);
  console.log('[Huntability] Favorability surface computed');
  
  // Step 3: Extract travel corridors
  const corridors = extractCorridors(grid);
  console.log('[Huntability] Corridors extracted:', { 
    primary: corridors.filter(c => c.tier === 'primary').length,
    secondary: corridors.filter(c => c.tier === 'secondary').length 
  });
  
  // Step 4: Detect convergence nodes (corridor-derived, structural signals required)
  const convergenceNodes = detectConvergenceNodes(grid, corridors, input.ridgeData?.saddle_nodes);
  console.log('[Huntability] Convergence nodes:', convergenceNodes.length);
  
  // Step 5: Compute huntability score
  const score = computeHuntabilityScore(grid, corridors, convergenceNodes, input.ridgeData);
  console.log('[Huntability] Score computed:', { overall: score.overall, grade: score.grade });
  
  // Convert to GeoJSON
  const favorabilitySurface = gridToFavorabilityGeoJSON(grid);
  const corridorLines = corridorsToGeoJSON(corridors);
  const convergencePoints = convergenceNodesToGeoJSON(convergenceNodes);
  
  // Terrain skeleton from input data
  const terrainSkeleton = {
    ridges: {
      type: 'FeatureCollection' as const,
      features: [
        ...(input.ridgeData?.ridges_primary?.features || []),
        ...(input.ridgeData?.ridges_secondary?.features || []),
      ],
    },
    saddles: input.ridgeData?.saddle_nodes || { type: 'FeatureCollection' as const, features: [] },
  };
  
  const processingTimeMs = Date.now() - startTime;
  
  return {
    grid,
    corridors,
    convergenceNodes,
    score,
    favorabilitySurface,
    corridorLines,
    convergencePoints,
    terrainSkeleton,
    metadata: {
      cellSizeM: HUNTABILITY_CELL_SIZE_M,
      gridDimensions: { rows: grid.rows, cols: grid.cols },
      corridorCount: {
        primary: corridors.filter(c => c.tier === 'primary').length,
        secondary: corridors.filter(c => c.tier === 'secondary').length,
      },
      convergenceCount: convergenceNodes.length,
      processingTimeMs,
      hasDEM: false, // For now, synthetic only
    },
  };
}

// Types are exported inline where defined
