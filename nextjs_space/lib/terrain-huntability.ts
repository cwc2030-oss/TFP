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

import { pointInAnyWaterBody } from './terrain-raster';

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

// Corridor extraction thresholds — v3.7.0 zone-based corridors
const CORRIDOR_THRESHOLDS = {
  primary_percentile: 0.82,   // Top ~18% = primary movement zones
  secondary_percentile: 0.65, // Top ~35% = secondary movement zones
  min_zone_cells: 4,          // Minimum 4 cells for a zone (~0.16 ha)
  min_spine_cells: 3,         // Minimum cells for a spine line
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
  /** NHD water body polygons — cells inside are excluded from corridors + bedding */
  waterBodies?: Array<{ coordinates: number[][][] }>;
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
  coordinates: [number, number][];       // Spine line through the zone
  avgFavorability: number;
  lengthM: number;
  // v3.7.0 zone metadata
  zoneHull?: [number, number][];          // Convex hull polygon (closed ring)
  zoneWidthM?: number;                    // Estimated zone width in meters
  zoneAreaCells?: number;                 // Number of cells in the zone
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

export interface BeddingZone {
  id: number;
  lng: number;
  lat: number;
  probability: number;     // 0-1 bedding likelihood
  radiusM: number;
  factors: {
    upperSlope: number;      // 0-1 upper-slope preference
    leewardAspect: number;   // 0-1 leeward aspect bonus
    ridgeDistance: number;   // 0-1 ridge-distance band (just below crest)
    slopeSuitability: number; // 0-1 moderate slope
    terrainShelter: number;  // 0-1 concave terrain shelter
    corridorOffset: number;  // 0-1 offset from primary corridors
  };
}

export interface HuntabilityResult {
  grid: HuntabilityGrid;
  corridors: Corridor[];
  convergenceNodes: ConvergenceNode[];
  score: HuntabilityScore;
  beddingZones: BeddingZone[];  // v3.6.0: Bedding Probability v1
  // GeoJSON for map rendering
  favorabilitySurface: GeoJSON.FeatureCollection;
  corridorLines: GeoJSON.FeatureCollection;
  corridorZones: GeoJSON.FeatureCollection;  // v3.7.0: Zone polygons
  convergencePoints: GeoJSON.FeatureCollection;
  beddingProbabilityGeoJSON: GeoJSON.FeatureCollection;  // v3.6.0: Bedding layer
  terrainSkeleton: {
    ridges: GeoJSON.FeatureCollection;
    saddles: GeoJSON.FeatureCollection;
  };
  metadata: {
    cellSizeM: number;
    gridDimensions: { rows: number; cols: number };
    corridorCount: { primary: number; secondary: number };
    convergenceCount: number;
    beddingZoneCount: number;  // v3.6.0
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
function computeFavorabilitySurface(
  grid: HuntabilityGrid,
  waterBodies?: Array<{ coordinates: number[][][] }>
): void {
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cells[r][c];

      // Water body exclusion — zero out cells inside water
      if (waterBodies?.length && pointInAnyWaterBody(cell.lng, cell.lat, waterBodies)) {
        cell.favorability = 0;
        continue;
      }
      
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

// ========== CORRIDOR EXTRACTION (v3.7.0 — Zone-Based) ==========

/**
 * Extract travel corridors as MOVEMENT ZONES from the favorability surface.
 *
 * v3.7.0: Instead of collapsing movement into single backbone lines, we:
 * 1. Threshold the favorability surface at the top ~18% (primary) and ~35% (secondary)
 * 2. Run connected-component labeling to find contiguous high-favorability patches
 * 3. For each patch, compute:
 *    - A convex-hull zone polygon (the "movement neighborhood")
 *    - A principal-axis spine line (for flow rendering & click targets)
 *    - Zone width, area, and average favorability for rendering decisions
 *
 * The result: multiple parallel routes and wide swaths where terrain supports them,
 * rather than a single repeating backbone.
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

  // Connected-component flood-fill for both tiers
  const corridors: Corridor[] = [];
  const visited: boolean[][] = Array(grid.rows).fill(null).map(() => Array(grid.cols).fill(false));
  let corridorId = 0;

  const floodFillTier = (tier: 'primary' | 'secondary') => {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (visited[r][c] || grid.cells[r][c].corridorTier !== tier) continue;

        const cells: Array<{ row: number; col: number }> = [];
        const stack: Array<[number, number]> = [[r, c]];

        while (stack.length > 0) {
          const [cr, cc] = stack.pop()!;
          if (visited[cr][cc]) continue;
          if (grid.cells[cr][cc].corridorTier !== tier) continue;

          visited[cr][cc] = true;
          cells.push({ row: cr, col: cc });
          grid.cells[cr][cc].corridorId = corridorId;

          // 8-connected neighbors
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

        if (cells.length >= CORRIDOR_THRESHOLDS.min_zone_cells) {
          const corridor = buildZoneCorridor(grid, cells, corridorId, tier);
          corridors.push(corridor);
          corridorId++;
        }
      }
    }
  };

  floodFillTier('primary');
  // Reset visited for secondary so secondary cells adjacent to primary are still found
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (grid.cells[r][c].corridorTier === 'secondary') {
        visited[r][c] = false;
      }
    }
  }
  floodFillTier('secondary');

  return corridors;
}

/**
 * Compute convex hull of a set of 2D points (Andrew's monotone chain).
 */
function convexHull(points: [number, number][]): [number, number][] {
  if (points.length < 3) return [...points, points[0]]; // Degenerate: return triangle/segment

  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  // Lower hull
  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }

  // Upper hull
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }

  // Remove last point of each half because it repeats
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  hull.push(hull[0]); // Close the ring
  return hull;
}

/**
 * Extract the principal-axis spine through a set of zone cells.
 *
 * Uses PCA to find the dominant direction, projects all cells onto it,
 * then walks along the projection to build a smooth spine line.
 */
function extractSpineLine(
  grid: HuntabilityGrid,
  cells: Array<{ row: number; col: number }>
): [number, number][] {
  if (cells.length < CORRIDOR_THRESHOLDS.min_spine_cells) return [];

  // Compute centroid (in cell coords)
  let sumR = 0, sumC = 0;
  for (const c of cells) { sumR += c.row; sumC += c.col; }
  const cR = sumR / cells.length;
  const cC = sumC / cells.length;

  // PCA: covariance matrix
  let cov00 = 0, cov01 = 0, cov11 = 0;
  for (const c of cells) {
    const dr = c.row - cR;
    const dc = c.col - cC;
    cov00 += dc * dc;
    cov01 += dc * dr;
    cov11 += dr * dr;
  }

  // Principal eigenvector via analytic 2x2 eigen decomposition
  const trace = cov00 + cov11;
  const det = cov00 * cov11 - cov01 * cov01;
  const discriminant = Math.sqrt(Math.max(0, trace * trace / 4 - det));
  // Largest eigenvalue
  const lambda1 = trace / 2 + discriminant;
  // Eigenvector for lambda1
  let ex = cov01;
  let ey = lambda1 - cov00;
  const len = Math.sqrt(ex * ex + ey * ey);
  if (len > 1e-8) { ex /= len; ey /= len; }
  else { ex = 1; ey = 0; } // Fallback: horizontal

  // Project each cell onto the principal axis
  const projected = cells.map(c => ({
    row: c.row,
    col: c.col,
    t: (c.col - cC) * ex + (c.row - cR) * ey,
    fav: grid.cells[c.row][c.col].favorability,
  }));

  // Sort by projection
  projected.sort((a, b) => a.t - b.t);

  // Bin the projections into ~8-12 spine segments and take the
  // favorability-weighted centroid of each bin → smooth spine
  const numBins = Math.min(12, Math.max(4, Math.ceil(projected.length / 3)));
  const minT = projected[0].t;
  const maxT = projected[projected.length - 1].t;
  const binWidth = (maxT - minT) / numBins;

  const spine: [number, number][] = [];
  for (let b = 0; b < numBins; b++) {
    const tLo = minT + b * binWidth;
    const tHi = tLo + binWidth;
    let wSum = 0, wLng = 0, wLat = 0;
    for (const p of projected) {
      if (p.t >= tLo && p.t < tHi) {
        const cell = grid.cells[p.row][p.col];
        const w = cell.favorability;
        wLng += cell.lng * w;
        wLat += cell.lat * w;
        wSum += w;
      }
    }
    if (wSum > 0) {
      spine.push([wLng / wSum, wLat / wSum]);
    }
  }

  // Handle last bin edge case (include the last point)
  if (spine.length === 0 && projected.length > 0) {
    const first = grid.cells[projected[0].row][projected[0].col];
    const last = grid.cells[projected[projected.length - 1].row][projected[projected.length - 1].col];
    spine.push([first.lng, first.lat], [last.lng, last.lat]);
  }

  return spine;
}

/**
 * Build a corridor zone from a set of connected cells.
 * Computes convex hull polygon, spine line, width, and area.
 */
function buildZoneCorridor(
  grid: HuntabilityGrid,
  cells: Array<{ row: number; col: number }>,
  id: number,
  tier: 'primary' | 'secondary'
): Corridor {
  // Collect coordinates and compute average favorability
  const coordinates: [number, number][] = [];
  let totalFav = 0;
  for (const c of cells) {
    const cell = grid.cells[c.row][c.col];
    coordinates.push([cell.lng, cell.lat]);
    totalFav += cell.favorability;
  }

  // Compute convex hull for zone polygon
  const hull = convexHull(coordinates);

  // Compute spine line through the zone
  const spine = extractSpineLine(grid, cells);

  // Estimate zone width (cells perpendicular to principal axis)
  // Use bounding box dimensions as proxy
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const c of cells) {
    minR = Math.min(minR, c.row); maxR = Math.max(maxR, c.row);
    minC = Math.min(minC, c.col); maxC = Math.max(maxC, c.col);
  }
  const spanR = (maxR - minR + 1) * grid.cellSizeM;
  const spanC = (maxC - minC + 1) * grid.cellSizeM;
  const lengthM = Math.max(spanR, spanC);
  const widthM = Math.min(spanR, spanC);

  return {
    id,
    tier,
    cells,
    coordinates: spine.length >= 2 ? spine : coordinates.slice(0, 2),
    avgFavorability: totalFav / cells.length,
    lengthM,
    // v3.7.0 zone metadata attached to the Corridor object
    zoneHull: hull,
    zoneWidthM: widthM,
    zoneAreaCells: cells.length,
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
 * v3.7.0: Convert corridors to GeoJSON LineStrings using PCA spine coordinates.
 * The spine is already computed in buildZoneCorridor; we just emit it directly.
 */
function corridorsToGeoJSON(corridors: Corridor[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  
  for (const corridor of corridors) {
    if (corridor.coordinates.length < 2) continue;
    
    features.push({
      type: 'Feature',
      properties: {
        id: `corridor_${corridor.id}`,
        tier: corridor.tier,
        likelihood: corridor.avgFavorability,
        lengthM: corridor.lengthM,
        corridorScore: corridor.avgFavorability,
        zoneWidthM: corridor.zoneWidthM ?? 0,
        zoneAreaCells: corridor.zoneAreaCells ?? 0,
      },
      geometry: {
        type: 'LineString',
        coordinates: corridor.coordinates,
      },
    });
  }
  
  return { type: 'FeatureCollection', features };
}

/**
 * v3.7.0: Convert corridor zone hulls to GeoJSON Polygons for fill rendering.
 * Each polygon represents a "movement neighborhood" — the area where terrain
 * supports travel, rendered as a subtle semi-transparent fill.
 */
function corridorZonesToGeoJSON(corridors: Corridor[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const corridor of corridors) {
    const hull = corridor.zoneHull;
    if (!hull || hull.length < 4) continue; // Need at least 3 points + closing point

    features.push({
      type: 'Feature',
      properties: {
        id: `corridor_zone_${corridor.id}`,
        tier: corridor.tier,
        likelihood: corridor.avgFavorability,
        lengthM: corridor.lengthM,
        corridorScore: corridor.avgFavorability,
        zoneWidthM: corridor.zoneWidthM ?? 0,
        zoneAreaCells: corridor.zoneAreaCells ?? 0,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [hull],
      },
    });
  }

  return { type: 'FeatureCollection', features };
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

// ========== BEDDING PROBABILITY v1 (v3.6.0) ==========

/**
 * Bedding Probability v1 — DEM-derived bedding likelihood zones.
 * 
 * Uses terrain structure signals (no vegetation data) to identify
 * areas where deer are likely to bed:
 * 
 * 1. Upper-slope preference: Deer prefer bedding high for vantage
 * 2. Leeward aspect: Wind-sheltered side of ridge/hill
 * 3. Ridge-distance band: Just below crest (not on top, not in valley)
 * 4. Moderate slope suitability: Comfortable angle for lying down
 * 5. Concave terrain shelter: Protected bowl/pocket terrain
 * 6. Corridor offset: Slight distance from primary travel paths
 * 
 * Rendered as muted earthy/plum tones — these are ORIGIN areas,
 * not travel lanes.
 */

// v3.6.1: Bedding Probability v2 — Tightened weights
// Shifted focus to ridge-shoulder, shelter, and corridor offset
const BEDDING_WEIGHTS = {
  upperSlope: 0.18,        // Upper-slope elevation position
  leewardAspect: 0.14,     // Leeward (NW/N in most regions) bonus
  ridgeDistance: 0.24,     // Ridge-shoulder band (strengthened)
  slopeSuitability: 0.12,  // Moderate slope (8-25%)
  terrainShelter: 0.18,    // Concave terrain pocket (strengthened)
  corridorOffset: 0.14,    // Not on movement lanes (strengthened)
};

// v3.6.1: Bedding detection thresholds — tightened for fewer, better pockets
const BEDDING_CONFIG = {
  minProbability: 0.55,    // Raised threshold: "likely" vs "capable"
  prominenceThreshold: 0.08, // v2: zone must exceed neighbors by this amount
  patchQualityThreshold: 0.35, // v2: surrounding cells must average above this
  maxZones: 8,             // Reduced from 12: target 3-6 actual
  radiusM: 28,             // Tighter, more compact pockets (was 35)
  minZoneSpacingCells: 5,  // Increased spacing (was 3): avoid scatter
  corridorOffsetMinM: 50,  // Raised minimum from 40m
  corridorOffsetHardGateM: 40, // v2: below this, shelter must be exceptional
  corridorOffsetMaxM: 150, // Maximum (too far is less ideal)
};

/**
 * Compute bedding probability for each cell in the grid.
 */
function computeBeddingProbability(
  grid: HuntabilityGrid, 
  corridors: Corridor[],
  waterBodies?: Array<{ coordinates: number[][][] }>
): void {
  // Build a quick lookup for corridor cells
  const corridorCells = new Set<string>();
  corridors.forEach(c => {
    if (c.tier === 'primary') {
      c.cells.forEach(cell => corridorCells.add(`${cell.row},${cell.col}`));
    }
  });
  
  for (let r = 1; r < grid.rows - 1; r++) {
    for (let c = 1; c < grid.cols - 1; c++) {
      const cell = grid.cells[r][c];

      // Zero out bedding probability for water body cells
      if (waterBodies?.length && pointInAnyWaterBody(cell.lng, cell.lat, waterBodies)) {
        (cell as any).bedding_probability = 0;
        (cell as any).bedding_factors = null;
        continue;
      }
      
      // v3.6.1: Tightened upper-slope scoring
      // Sweet spot narrowed to 0.45-0.70 (ridge-shoulder focus)
      let upperSlope = 0;
      if (cell.ridge_prox >= 0.50 && cell.ridge_prox <= 0.70) {
        upperSlope = 0.95; // Optimal ridge-shoulder band
      } else if (cell.ridge_prox >= 0.45 && cell.ridge_prox < 0.50) {
        upperSlope = 0.75; // Good
      } else if (cell.ridge_prox > 0.70 && cell.ridge_prox <= 0.78) {
        upperSlope = 0.55; // Getting close to crest
      } else if (cell.ridge_prox > 0.78) {
        upperSlope = 0.15; // Too exposed on ridge crest
      } else if (cell.ridge_prox >= 0.35) {
        upperSlope = 0.35; // Mid-slope, acceptable with other factors
      } else {
        upperSlope = 0.10; // Valley/low terrain — deer don't bed here
      }
      
      // 2. Leeward aspect (simplified: assume NW/N winds dominant)
      const ridgeN = grid.cells[r - 1][c].ridge_prox;
      const ridgeS = grid.cells[r + 1][c].ridge_prox;
      const ridgeE = grid.cells[r][c + 1].ridge_prox;
      const ridgeW = grid.cells[r][c - 1].ridge_prox;
      
      // Leeward = ridge is to the NW (upslope to NW = leeward on SE side)
      const leewardSignal = (ridgeN + ridgeW) / 2 - (ridgeS + ridgeE) / 2;
      const leewardAspect = leewardSignal > 0.05 ? Math.min(1, leewardSignal * 3) : 0;
      
      // v3.6.1: Ridge-distance band tightened (optimal: 0.55-0.70)
      // This is the "ridge-shoulder" — just below crest, sheltered
      let ridgeDistance = 0;
      if (cell.ridge_prox >= 0.55 && cell.ridge_prox <= 0.70) {
        ridgeDistance = 1.0; // Perfect ridge-shoulder
      } else if (cell.ridge_prox >= 0.50 && cell.ridge_prox < 0.55) {
        ridgeDistance = 0.75;
      } else if (cell.ridge_prox > 0.70 && cell.ridge_prox <= 0.78) {
        ridgeDistance = 0.50; // Higher on ridge, less sheltered
      } else if (cell.ridge_prox >= 0.40 && cell.ridge_prox < 0.50) {
        ridgeDistance = 0.35;
      } else {
        ridgeDistance = 0.10; // Valley or exposed crest
      }
      
      // 4. Moderate slope suitability
      let slopeSuitability = 0;
      if (cell.slope_pref >= 0.7) {
        slopeSuitability = 0.4; // Good for travel, less ideal for bedding
      } else if (cell.slope_pref >= 0.45 && cell.slope_pref < 0.7) {
        slopeSuitability = 0.85; // Optimal for bedding (gentler)
      } else if (cell.slope_pref < 0.45 && cell.bench > 0.55) {
        slopeSuitability = 0.95; // Flat bench = ideal bedding
      } else {
        slopeSuitability = 0.25;
      }
      
      // v3.6.1: Terrain shelter scoring — tightened thresholds
      // Require stronger shelter signal (concave pocket)
      let terrainShelter = 0;
      if (cell.drainage_pen < 0.15 && cell.bench >= 0.45 && cell.bench < 0.75) {
        terrainShelter = 0.95; // Strongly sheltered pocket
      } else if (cell.drainage_pen < 0.20 && cell.bench >= 0.40 && cell.bench < 0.80) {
        terrainShelter = 0.70; // Good shelter
      } else if (cell.drainage_pen < 0.28 && cell.bench >= 0.35) {
        terrainShelter = 0.40;
      } else {
        terrainShelter = 0.10; // Exposed or wet
      }
      
      // v3.6.1: Corridor offset — tightened with hard gate
      // Deer don't bed ON corridors or immediately adjacent
      let corridorOffset = 0;
      const cellKey = `${r},${c}`;
      
      if (corridorCells.has(cellKey)) {
        corridorOffset = 0; // On corridor = no bedding
      } else {
        // Check distance to nearest corridor cell
        let minCorridorDist = Infinity;
        corridors.forEach(corridor => {
          if (corridor.tier === 'primary') {
            corridor.cells.forEach(cc => {
              const dist = Math.sqrt((cc.row - r) ** 2 + (cc.col - c) ** 2);
              minCorridorDist = Math.min(minCorridorDist, dist);
            });
          }
        });
        
        const distM = minCorridorDist * grid.cellSizeM;
        
        if (distM >= BEDDING_CONFIG.corridorOffsetMinM && 
            distM <= BEDDING_CONFIG.corridorOffsetMaxM) {
          // Optimal offset band (50-150m)
          corridorOffset = 0.95;
        } else if (distM > BEDDING_CONFIG.corridorOffsetMaxM) {
          // Far from corridors — still okay
          corridorOffset = 0.50;
        } else if (distM >= BEDDING_CONFIG.corridorOffsetHardGateM) {
          // 40-50m: acceptable only with exceptional shelter
          corridorOffset = terrainShelter >= 0.70 ? 0.55 : 0.20;
        } else if (distM >= 25) {
          // 25-40m: very close — only exceptional shelter saves it
          corridorOffset = terrainShelter >= 0.90 ? 0.30 : 0.05;
        } else {
          // < 25m: too close, essentially on the movement lane
          corridorOffset = 0.0;
        }
      }
      
      // Store factors in cell (for inspection)
      (cell as any).bedding_factors = {
        upperSlope,
        leewardAspect,
        ridgeDistance,
        slopeSuitability,
        terrainShelter,
        corridorOffset,
      };
      
      // Weighted combination
      (cell as any).bedding_probability = 
        upperSlope * BEDDING_WEIGHTS.upperSlope +
        leewardAspect * BEDDING_WEIGHTS.leewardAspect +
        ridgeDistance * BEDDING_WEIGHTS.ridgeDistance +
        slopeSuitability * BEDDING_WEIGHTS.slopeSuitability +
        terrainShelter * BEDDING_WEIGHTS.terrainShelter +
        corridorOffset * BEDDING_WEIGHTS.corridorOffset;
    }
  }
}

/**
 * v3.6.1: Extract bedding zones from computed probabilities.
 * Tightened with prominence filter, patch quality gate, and expanded neighborhood.
 */
function extractBeddingZones(grid: HuntabilityGrid, waterBodies?: Array<{ coordinates: number[][][] }>): BeddingZone[] {
  const candidates: Array<{
    row: number;
    col: number;
    probability: number;
    prominence: number;  // v2: how much it exceeds neighbors
    patchQuality: number; // v2: average of surrounding cells
    factors: BeddingZone['factors'];
  }> = [];
  
  // v3.6.1: Expanded boundary margin for 5x5 neighborhood
  const margin = 3;
  
  // Find local maxima above threshold with v2 filters
  for (let r = margin; r < grid.rows - margin; r++) {
    for (let c = margin; c < grid.cols - margin; c++) {
      const cell = grid.cells[r][c];
      const prob = (cell as any).bedding_probability || 0;
      
      if (prob < BEDDING_CONFIG.minProbability) continue;
      
      // v3.6.1: Expanded local maximum check (5x5 neighborhood)
      let isMax = true;
      let neighborSum = 0;
      let neighborCount = 0;
      let maxNeighborProb = 0;
      
      for (let dr = -2; dr <= 2 && isMax; dr++) {
        for (let dc = -2; dc <= 2 && isMax; dc++) {
          if (dr === 0 && dc === 0) continue;
          const neighbor = grid.cells[r + dr][c + dc];
          const neighborProb = (neighbor as any).bedding_probability || 0;
          
          // For immediate neighbors (3x3), require strict maximum
          if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) {
            if (neighborProb > prob) {
              isMax = false;
            }
          }
          
          neighborSum += neighborProb;
          neighborCount++;
          maxNeighborProb = Math.max(maxNeighborProb, neighborProb);
        }
      }
      
      if (!isMax) continue;
      
      // v3.6.1: Prominence filter — zone must meaningfully exceed neighbors
      const prominence = prob - maxNeighborProb;
      if (prominence < BEDDING_CONFIG.prominenceThreshold) continue;
      
      // v3.6.1: Patch quality filter — surrounding cells must be decent
      const patchQuality = neighborSum / neighborCount;
      if (patchQuality < BEDDING_CONFIG.patchQualityThreshold) continue;
      
      candidates.push({
        row: r,
        col: c,
        probability: prob,
        prominence,
        patchQuality,
        factors: (cell as any).bedding_factors || {
          upperSlope: 0,
          leewardAspect: 0,
          ridgeDistance: 0,
          slopeSuitability: 0,
          terrainShelter: 0,
          corridorOffset: 0,
        },
      });
    }
  }
  
  // Sort by combined score: probability + prominence bonus
  candidates.sort((a, b) => {
    const scoreA = a.probability + a.prominence * 0.5 + a.patchQuality * 0.3;
    const scoreB = b.probability + b.prominence * 0.5 + b.patchQuality * 0.3;
    return scoreB - scoreA;
  });
  
  // v3.6.1: Non-max suppression with increased spacing
  const zones: BeddingZone[] = [];
  const used = new Set<string>();
  const spacing = BEDDING_CONFIG.minZoneSpacingCells;
  
  for (const cand of candidates) {
    if (zones.length >= BEDDING_CONFIG.maxZones) break;
    
    // Check if too close to existing zone
    let tooClose = false;
    for (let dr = -spacing; dr <= spacing && !tooClose; dr++) {
      for (let dc = -spacing; dc <= spacing && !tooClose; dc++) {
        if (used.has(`${cand.row + dr},${cand.col + dc}`)) {
          tooClose = true;
        }
      }
    }
    
    if (tooClose) continue;
    
    // Skip zones inside water bodies
    const zCell = grid.cells[cand.row][cand.col];
    if (waterBodies?.length && pointInAnyWaterBody(zCell.lng, zCell.lat, waterBodies)) continue;
    
    // Mark zone and surrounding cells as used
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        used.add(`${cand.row + dr},${cand.col + dc}`);
      }
    }
    
    // Get coordinates
    const cell = grid.cells[cand.row][cand.col];
    
    zones.push({
      id: zones.length + 1,
      lng: cell.lng,
      lat: cell.lat,
      probability: cand.probability,
      radiusM: BEDDING_CONFIG.radiusM,
      factors: cand.factors,
    });
  }
  
  return zones;
}

/**
 * Convert bedding zones to GeoJSON for map rendering.
 * Uses circles (Points with radius) rendered as subtle plum/earthy fills.
 */
function beddingZonesToGeoJSON(zones: BeddingZone[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = zones.map(zone => ({
    type: 'Feature' as const,
    properties: {
      id: `bedding_${zone.id}`,
      beddingScore: zone.probability,
      radiusM: zone.radiusM,
      // Expose factors for terrain reasons panel
      upperSlope: zone.factors.upperSlope,
      leewardAspect: zone.factors.leewardAspect,
      ridgeDistance: zone.factors.ridgeDistance,
      slopeSuitability: zone.factors.slopeSuitability,
      terrainShelter: zone.factors.terrainShelter,
      corridorOffset: zone.factors.corridorOffset,
    },
    geometry: {
      type: 'Point' as const,
      coordinates: [zone.lng, zone.lat],
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
  computeFavorabilitySurface(grid, input.waterBodies);
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
  
  // Step 6 (v3.6.0): Compute bedding probability zones
  computeBeddingProbability(grid, corridors, input.waterBodies);
  const beddingZones = extractBeddingZones(grid, input.waterBodies);
  console.log('[Huntability] Bedding zones extracted:', beddingZones.length);
  
  // Convert to GeoJSON
  const favorabilitySurface = gridToFavorabilityGeoJSON(grid);
  const corridorLines = corridorsToGeoJSON(corridors);
  const corridorZones = corridorZonesToGeoJSON(corridors);  // v3.7.0: zone polygons
  const convergencePoints = convergenceNodesToGeoJSON(convergenceNodes);
  const beddingProbabilityGeoJSON = beddingZonesToGeoJSON(beddingZones);
  
  console.log('[Huntability] v3.7.0 corridor zones:', corridorZones.features.length, 'polygons');
  
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
    beddingZones,
    favorabilitySurface,
    corridorLines,
    corridorZones,
    convergencePoints,
    beddingProbabilityGeoJSON,
    terrainSkeleton,
    metadata: {
      cellSizeM: HUNTABILITY_CELL_SIZE_M,
      gridDimensions: { rows: grid.rows, cols: grid.cols },
      corridorCount: {
        primary: corridors.filter(c => c.tier === 'primary').length,
        secondary: corridors.filter(c => c.tier === 'secondary').length,
      },
      convergenceCount: convergenceNodes.length,
      beddingZoneCount: beddingZones.length,
      processingTimeMs,
      hasDEM: false, // For now, synthetic only
    },
  };
}

// Types are exported inline where defined
