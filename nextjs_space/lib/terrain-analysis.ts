/**
 * Terrain Analysis Library
 * 
 * Computes terrain-derived movement likelihood surfaces from DEM data.
 * Uses buffered analysis extent around parcel for landscape context.
 * 
 * This is NOT wildlife AI — it's terrain-guided movement structure.
 * 
 * Core Philosophy:
 * "Given terrain structure (ridges, benches, saddles, slopes, convergence),
 * where would terrain tend to guide or facilitate movement?"
 * 
 * Analysis is run on a buffered landscape window (1-2km beyond parcel)
 * to capture incoming/outgoing terrain structure. Final display may be
 * clipped to parcel or parcel + immediate context.
 * 
 * REMOVED FROM SYNTHETIC:
 * - Parcel aspect ratio / dominant axis
 * - Parcel orientation heuristics
 * - Geometric endpoint clustering
 * - Property-line-anchored flow generation
 * 
 * ADDED FOR TERRAIN-DRIVEN:
 * - Slope preference (moderate slopes favored)
 * - Bench likelihood (sidehill travel benches)
 * - Saddle proximity (terrain crossing approaches)
 * - Spine/ridge proximity (ridge-structured movement)
 * - Terrain convergence (natural pinch/funnel geometry)
 * - Extreme slope penalty (steep terrain penalty)
 * - Cut/valley penalty (incised drainage penalty)
 */

import type {
  TerrainFlowResponse,
  FlowLineProperties,
  ConvergenceZoneProperties,
  OpportunityZoneProperties,
  FlowTier,
} from '@/types/terrain-flow';

// ========== ANALYSIS CONFIGURATION ==========

// Buffer size for analysis extent (meters)
export const ANALYSIS_BUFFER_M = 1000; // 1km default
export const ANALYSIS_BUFFER_MAX_M = 2000; // 2km max

// Component weights for terrain flow likelihood
// NOTE: saddle_proximity zeroed — saddles must NOT attract flow routing.
// Saddles are re-confirmed by proximity AFTER corridor paths are finalized.
export const TERRAIN_FLOW_WEIGHTS = {
  bench_likelihood: 0.32,       // Sidehill travel benches (was 0.28)
  saddle_proximity: 0.00,       // DISABLED — saddles confirmed post-routing only
  spine_proximity: 0.28,        // Ridge-structured movement (was 0.20)
  terrain_convergence: 0.24,    // Natural pinch/funnel geometry (was 0.18)
  moderate_slope: 0.16,         // Energy-efficient travel slopes (was 0.10)
  // Penalties (subtracted)
  extreme_slope_penalty: 0.12,  // Steep terrain penalty
  cut_penalty: 0.08,            // Incised drainage penalty
};

// Slope preference bands (degrees)
export const SLOPE_BANDS = {
  optimal_min: 5,
  optimal_max: 15,
  acceptable_min: 2,
  acceptable_max: 25,
  penalty_threshold: 35,
  extreme_threshold: 45,
};

// Flow extraction thresholds (BASE values - will be scaled by parcel size)
export const FLOW_THRESHOLDS = {
  primary_percentile: 0.75,     // Top 25% likelihood
  secondary_percentile: 0.55,   // Top 45% likelihood
  min_length_m_primary: 150,    // BASE - scales with parcel
  min_length_m_secondary: 80,   // BASE - scales with parcel
  convergence_threshold: 0.70,
  opportunity_threshold: 0.80,
};

// ========== PARCEL-ADAPTIVE SCALING ==========

/**
 * Reference diagonal for a 40-acre parcel (~400m x 400m)
 * All scaling is relative to this "typical" parcel size
 */
const REFERENCE_DIAGONAL_M = 565; // sqrt(400^2 + 400^2)

/**
 * Spatial scaling parameters (BASE values at reference size)
 * These parameters control the spatial extent of flow features
 */
export const SPATIAL_SCALING_BASE = {
  flow_min_length_primary: 150,      // Base minimum primary flow length (m)
  flow_min_length_secondary: 80,     // Base minimum secondary flow length (m)
  convergence_search_radius: 100,    // Base radius for flow proximity search (m)
  convergence_base_radius: 30,       // Base convergence zone display radius (m)
  opportunity_radius: 25,            // Base opportunity zone radius (m)
  gaussian_smooth_cells: 3,          // Base smoothing kernel radius (cells)
  max_convergence_zones: 3,          // Base max convergence zones (convergence IS opportunity)
  max_opportunity_zones: 3,          // Base max opportunity zones
};

/**
 * Parcel scale metrics computed from parcel dimensions
 */
export interface ParcelScaleMetrics {
  widthM: number;
  heightM: number;
  diagonalM: number;
  areaAcres: number;
  scaleFactor: number;        // 1.0 for reference size, increases for larger parcels
  
  // Scaled parameters
  minLengthPrimary: number;
  minLengthSecondary: number;
  convergenceSearchRadius: number;
  convergenceBaseRadius: number;
  opportunityRadius: number;
  gaussianSmoothCells: number;
  maxConvergenceZones: number;
  maxOpportunityZones: number;
}

/**
 * Compute parcel-adaptive scaling metrics
 * 
 * @param widthM - Parcel width in meters
 * @param heightM - Parcel height in meters
 * @returns ParcelScaleMetrics with scaled parameters
 */
export function computeParcelScale(widthM: number, heightM: number, isTerritory: boolean = false): ParcelScaleMetrics {
  const diagonalM = Math.sqrt(widthM * widthM + heightM * heightM);
  const areaAcres = (widthM * heightM * 0.8) / 4046.86; // ~80% fill factor
  
  // Scale factor: 1.0 at reference size, increases for larger parcels
  // Clamped between 1.0 (small parcels stay tight) and 2.5 (avoid runaway scaling)
  // v4.1: Territory mode caps at 1.5 — prevents cross-parcel bbox inflation from
  // suppressing flow lines on lower-relief parcels. The unified flow field still
  // computes on the full territory extent; only the min-length filter relaxes.
  const maxScale = isTerritory ? 1.5 : 2.5;
  const rawScale = diagonalM / REFERENCE_DIAGONAL_M;
  const scaleFactor = Math.max(1.0, Math.min(maxScale, rawScale));
  
  // Apply non-linear scaling for very large parcels (diminishing returns)
  // Use square root scaling for zone counts to avoid excessive features
  const countScale = 1 + Math.sqrt(scaleFactor - 1) * 1.5;
  
  return {
    widthM,
    heightM,
    diagonalM,
    areaAcres,
    scaleFactor,
    
    // Flow line lengths scale directly with parcel size
    // Phase B: In territory mode, drop length thresholds entirely —
    // extract ALL candidates and classify at display via Green/Blue/Black tiers
    minLengthPrimary: isTerritory ? 0 : Math.round(SPATIAL_SCALING_BASE.flow_min_length_primary * scaleFactor),
    minLengthSecondary: isTerritory ? 0 : Math.round(SPATIAL_SCALING_BASE.flow_min_length_secondary * scaleFactor),
    
    // Search and display radii scale with parcel size
    convergenceSearchRadius: Math.round(SPATIAL_SCALING_BASE.convergence_search_radius * scaleFactor),
    convergenceBaseRadius: Math.round(SPATIAL_SCALING_BASE.convergence_base_radius * scaleFactor),
    opportunityRadius: Math.round(SPATIAL_SCALING_BASE.opportunity_radius * scaleFactor),
    
    // Smoothing scales more gently (diminishing returns)
    gaussianSmoothCells: Math.min(6, Math.ceil(SPATIAL_SCALING_BASE.gaussian_smooth_cells * Math.sqrt(scaleFactor))),
    
    // Zone counts scale with square root (fewer additional zones on very large parcels)
    maxConvergenceZones: Math.min(10, Math.round(SPATIAL_SCALING_BASE.max_convergence_zones * countScale)),
    maxOpportunityZones: Math.min(6, Math.round(SPATIAL_SCALING_BASE.max_opportunity_zones * countScale)),
  };
}

/**
 * Get scaled flow thresholds based on parcel scale
 */
export function getScaledFlowThresholds(scale: ParcelScaleMetrics): typeof FLOW_THRESHOLDS {
  return {
    ...FLOW_THRESHOLDS,
    min_length_m_primary: scale.minLengthPrimary,
    min_length_m_secondary: scale.minLengthSecondary,
  };
}

// ========== GEOMETRY UTILITIES ==========

export function distanceMeters(p1: [number, number], p2: [number, number]): number {
  const R = 6371000;
  const dLat = (p2[1] - p1[1]) * Math.PI / 180;
  const dLng = (p2[0] - p1[0]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1[1] * Math.PI / 180) * Math.cos(p2[1] * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function calculateBearing(from: [number, number], to: [number, number]): number {
  const lat1 = from[1] * Math.PI / 180;
  const lat2 = to[1] * Math.PI / 180;
  const dLng = (to[0] - from[0]) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

export function movePoint(point: [number, number], bearing: number, distanceM: number): [number, number] {
  const R = 6371000;
  const lat1 = point[1] * Math.PI / 180;
  const lng1 = point[0] * Math.PI / 180;
  const brng = bearing * Math.PI / 180;
  const d = distanceM / R;
  
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );
  
  return [lng2 * 180 / Math.PI, lat2 * 180 / Math.PI];
}

export function getBbox(coords: number[][]): [number, number, number, number] {
  const lngs = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  return [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats),
  ];
}

export function getCentroid(coords: number[][]): [number, number] {
  const n = coords.length;
  const sumLng = coords.reduce((sum, c) => sum + c[0], 0);
  const sumLat = coords.reduce((sum, c) => sum + c[1], 0);
  return [sumLng / n, sumLat / n];
}

/**
 * Expand bounding box by buffer distance (meters)
 */
export function expandBbox(
  bbox: [number, number, number, number],
  bufferM: number
): [number, number, number, number] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const centerLat = (minLat + maxLat) / 2;
  
  // Approximate degrees per meter at this latitude
  const latDegPerM = 1 / 111320;
  const lngDegPerM = 1 / (111320 * Math.cos(centerLat * Math.PI / 180));
  
  const bufferLat = bufferM * latDegPerM;
  const bufferLng = bufferM * lngDegPerM;
  
  return [
    minLng - bufferLng,
    minLat - bufferLat,
    maxLng + bufferLng,
    maxLat + bufferLat,
  ];
}

/**
 * Create a buffered polygon around the parcel for analysis
 */
export function createBufferedParcel(
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  bufferM: number
): GeoJSON.Feature<GeoJSON.Polygon> {
  // Extract ALL outer rings from Polygon or MultiPolygon
  let allCoords: number[][] = [];
  if (parcel.geometry.type === 'Polygon') {
    allCoords = parcel.geometry.coordinates[0];
  } else {
    // MultiPolygon: gather vertices from ALL sub-polygons so the
    // buffered extent covers the entire territory, not just the largest parcel.
    for (const poly of parcel.geometry.coordinates) {
      allCoords.push(...poly[0]);
    }
  }
  
  if (allCoords.length < 4) {
    // Return original if too simple
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [allCoords],
      },
    };
  }
  
  const centroid = getCentroid(allCoords);
  
  // Simple radial buffer: push each vertex outward from centroid
  const bufferedCoords = allCoords.map(coord => {
    const bearing = calculateBearing(centroid, [coord[0], coord[1]]);
    const dist = distanceMeters(centroid, [coord[0], coord[1]]);
    const newDist = dist + bufferM;
    return movePoint(centroid, bearing, newDist);
  });
  
  // Close the ring
  if (bufferedCoords[0][0] !== bufferedCoords[bufferedCoords.length - 1][0] ||
      bufferedCoords[0][1] !== bufferedCoords[bufferedCoords.length - 1][1]) {
    bufferedCoords.push([...bufferedCoords[0]] as [number, number]);
  }
  
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [bufferedCoords],
    },
  };
}

// ========== TERRAIN COMPONENT RASTERS ==========

/**
 * Terrain Grid - represents a rasterized terrain surface
 */
export interface TerrainGrid {
  data: number[][];           // 2D array of values (0-1 normalized)
  bbox: [number, number, number, number];
  resolution_m: number;        // Cell size in meters
  rows: number;
  cols: number;
}

/**
 * Component Rasters - all terrain-derived surfaces
 */
export interface ComponentRasters {
  slope_preference: TerrainGrid | null;      // Moderate slope bonus
  bench_likelihood: TerrainGrid | null;      // Sidehill bench detection
  saddle_proximity: TerrainGrid | null;      // Distance to saddles
  spine_proximity: TerrainGrid | null;       // Distance to ridges
  terrain_convergence: TerrainGrid | null;   // Pinch/funnel geometry
  extreme_slope_penalty: TerrainGrid | null; // Steep terrain penalty
  cut_penalty: TerrainGrid | null;           // Valley/drainage penalty
  flow_likelihood: TerrainGrid | null;       // Combined weighted surface
}

/**
 * Create empty terrain grid
 */
export function createEmptyGrid(
  bbox: [number, number, number, number],
  resolution_m: number = 30
): TerrainGrid {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const centerLat = (minLat + maxLat) / 2;
  
  // Calculate grid dimensions
  const widthM = distanceMeters([minLng, centerLat], [maxLng, centerLat]);
  const heightM = distanceMeters([minLng, minLat], [minLng, maxLat]);
  
  const cols = Math.max(10, Math.ceil(widthM / resolution_m));
  const rows = Math.max(10, Math.ceil(heightM / resolution_m));
  
  // Initialize with zeros
  const data: number[][] = Array(rows).fill(null).map(() => Array(cols).fill(0));
  
  return {
    data,
    bbox,
    resolution_m,
    rows,
    cols,
  };
}

/**
 * Get grid cell indices for a coordinate
 */
export function coordToCell(
  coord: [number, number],
  grid: TerrainGrid
): { row: number; col: number } | null {
  const [minLng, minLat, maxLng, maxLat] = grid.bbox;
  
  if (coord[0] < minLng || coord[0] > maxLng ||
      coord[1] < minLat || coord[1] > maxLat) {
    return null;
  }
  
  const col = Math.floor((coord[0] - minLng) / (maxLng - minLng) * grid.cols);
  const row = Math.floor((coord[1] - minLat) / (maxLat - minLat) * grid.rows);
  
  return {
    row: Math.min(row, grid.rows - 1),
    col: Math.min(col, grid.cols - 1),
  };
}

/**
 * Get coordinate for grid cell center
 */
export function cellToCoord(
  row: number,
  col: number,
  grid: TerrainGrid
): [number, number] {
  const [minLng, minLat, maxLng, maxLat] = grid.bbox;
  
  const lng = minLng + (col + 0.5) / grid.cols * (maxLng - minLng);
  const lat = minLat + (row + 0.5) / grid.rows * (maxLat - minLat);
  
  return [lng, lat];
}

// ========== TERRAIN COMPONENT COMPUTATION ==========

/**
 * Compute slope preference from corridor data
 * Corridors with moderate slopes are preferred
 */
export function computeSlopePreference(
  corridorData: any,
  bbox: [number, number, number, number],
  resolution_m: number = 30
): TerrainGrid {
  const grid = createEmptyGrid(bbox, resolution_m);
  const corridors = corridorData?.corridors?.features || corridorData?.features || [];
  
  // Initialize with moderate baseline
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      grid.data[r][c] = 0.3; // Base preference
    }
  }
  
  // Mark cells along corridors with slope preference based on probability
  corridors.forEach((corridor: any) => {
    if (!corridor.geometry?.coordinates) return;
    const coords = corridor.geometry.coordinates;
    const prob = (corridor.properties?.probability || 50) / 100;
    const avgSlope = corridor.properties?.avg_slope || 10;
    
    // Compute slope preference (higher for moderate slopes)
    let slopeScore = 0;
    if (avgSlope >= SLOPE_BANDS.optimal_min && avgSlope <= SLOPE_BANDS.optimal_max) {
      slopeScore = 1.0; // Optimal slope
    } else if (avgSlope >= SLOPE_BANDS.acceptable_min && avgSlope <= SLOPE_BANDS.acceptable_max) {
      slopeScore = 0.7; // Acceptable slope
    } else if (avgSlope > SLOPE_BANDS.penalty_threshold) {
      slopeScore = 0.2; // Penalized steep slope
    } else {
      slopeScore = 0.5; // Moderate preference
    }
    
    const value = Math.min(1, prob * 0.6 + slopeScore * 0.4);
    
    coords.forEach((coord: number[]) => {
      const cell = coordToCell([coord[0], coord[1]], grid);
      if (cell) {
        grid.data[cell.row][cell.col] = Math.max(grid.data[cell.row][cell.col], value);
      }
    });
  });
  
  // Gaussian smooth to spread influence
  return gaussianSmooth(grid, 2);
}

/**
 * Compute bench likelihood from corridor concavity patterns
 * Benches are flat areas on hillsides (sidehill travel)
 */
export function computeBenchLikelihood(
  corridorData: any,
  bbox: [number, number, number, number],
  resolution_m: number = 30
): TerrainGrid {
  const grid = createEmptyGrid(bbox, resolution_m);
  const corridors = corridorData?.corridors?.features || corridorData?.features || [];
  
  // Corridors with high concavity weight and moderate slopes indicate benches
  corridors.forEach((corridor: any) => {
    if (!corridor.geometry?.coordinates) return;
    const coords = corridor.geometry.coordinates;
    const prob = (corridor.properties?.probability || 50) / 100;
    const concavity = corridor.properties?.concavity_score || 0.5;
    const avgSlope = corridor.properties?.avg_slope || 10;
    
    // Bench likelihood: high concavity + moderate slope + high probability
    const isModerateSlope = avgSlope >= 5 && avgSlope <= 20;
    const benchScore = isModerateSlope 
      ? prob * 0.4 + concavity * 0.6
      : prob * 0.2 + concavity * 0.3;
    
    coords.forEach((coord: number[]) => {
      const cell = coordToCell([coord[0], coord[1]], grid);
      if (cell) {
        grid.data[cell.row][cell.col] = Math.max(grid.data[cell.row][cell.col], benchScore);
      }
    });
  });
  
  return gaussianSmooth(grid, 3);
}

/**
 * Compute saddle proximity from corridor endpoints/intersections
 * Saddles are low points on ridges where movement crosses
 */
export function computeSaddleProximity(
  corridorData: any,
  ridgeData: any,
  bbox: [number, number, number, number],
  resolution_m: number = 30
): TerrainGrid {
  const grid = createEmptyGrid(bbox, resolution_m);
  const corridors = corridorData?.corridors?.features || corridorData?.features || [];
  const ridges = ridgeData?.ridges_primary?.features || [];
  const saddles = ridgeData?.saddle_nodes?.features || [];
  
  // Use actual saddle nodes if available
  saddles.forEach((saddle: any) => {
    if (!saddle.geometry?.coordinates) return;
    const coord = saddle.geometry.coordinates;
    const intensity = saddle.properties?.drop_ft ? Math.min(1, saddle.properties.drop_ft / 50) : 0.7;
    
    applySaddleInfluence(grid, [coord[0], coord[1]], intensity, 200);
  });
  
  // Also detect saddle candidates from corridor-ridge intersections
  corridors.forEach((corridor: any) => {
    if (!corridor.geometry?.coordinates) return;
    const coords = corridor.geometry.coordinates;
    const prob = (corridor.properties?.probability || 50) / 100;
    
    // Check endpoints as potential saddle crossings
    if (coords.length >= 2 && prob > 0.5) {
      const start = coords[0];
      const end = coords[coords.length - 1];
      
      // Higher intensity for high-probability corridor endpoints
      applySaddleInfluence(grid, [start[0], start[1]], prob * 0.4, 100);
      applySaddleInfluence(grid, [end[0], end[1]], prob * 0.4, 100);
    }
  });
  
  return grid;
}

/**
 * Apply saddle influence with distance decay
 */
function applySaddleInfluence(
  grid: TerrainGrid,
  center: [number, number],
  intensity: number,
  radiusM: number
): void {
  const maxCells = Math.ceil(radiusM / grid.resolution_m);
  const centerCell = coordToCell(center, grid);
  if (!centerCell) return;
  
  for (let dr = -maxCells; dr <= maxCells; dr++) {
    for (let dc = -maxCells; dc <= maxCells; dc++) {
      const r = centerCell.row + dr;
      const c = centerCell.col + dc;
      if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) continue;
      
      const cellCoord = cellToCoord(r, c, grid);
      const dist = distanceMeters(center, cellCoord);
      if (dist > radiusM) continue;
      
      // Distance decay
      const decay = 1 - (dist / radiusM);
      const value = intensity * decay * decay; // Quadratic decay
      
      grid.data[r][c] = Math.max(grid.data[r][c], value);
    }
  }
}

/**
 * Compute spine/ridge proximity from ridge data
 */
export function computeSpineProximity(
  ridgeData: any,
  bbox: [number, number, number, number],
  resolution_m: number = 30
): TerrainGrid {
  const grid = createEmptyGrid(bbox, resolution_m);
  const primaryRidges = ridgeData?.ridges_primary?.features || [];
  const secondaryRidges = ridgeData?.ridges_secondary?.features || [];
  
  // Apply influence from primary ridges (stronger)
  primaryRidges.forEach((ridge: any) => {
    if (!ridge.geometry?.coordinates) return;
    applyLineInfluence(grid, ridge.geometry.coordinates, 0.9, 150);
  });
  
  // Apply influence from secondary ridges (moderate)
  secondaryRidges.forEach((ridge: any) => {
    if (!ridge.geometry?.coordinates) return;
    applyLineInfluence(grid, ridge.geometry.coordinates, 0.6, 100);
  });
  
  return grid;
}

/**
 * Apply line influence with distance decay
 */
function applyLineInfluence(
  grid: TerrainGrid,
  coords: number[][],
  intensity: number,
  radiusM: number
): void {
  const maxCells = Math.ceil(radiusM / grid.resolution_m);
  
  coords.forEach(coord => {
    const centerCell = coordToCell([coord[0], coord[1]], grid);
    if (!centerCell) return;
    
    for (let dr = -maxCells; dr <= maxCells; dr++) {
      for (let dc = -maxCells; dc <= maxCells; dc++) {
        const r = centerCell.row + dr;
        const c = centerCell.col + dc;
        if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) continue;
        
        const cellCoord = cellToCoord(r, c, grid);
        const dist = distanceMeters([coord[0], coord[1]], cellCoord);
        if (dist > radiusM) continue;
        
        const decay = 1 - (dist / radiusM);
        const value = intensity * decay;
        
        grid.data[r][c] = Math.max(grid.data[r][c], value);
      }
    }
  });
}

/**
 * Compute terrain convergence from corridor density/overlap
 * High values where multiple corridors converge or terrain pinches
 */
export function computeTerrainConvergence(
  corridorData: any,
  bbox: [number, number, number, number],
  resolution_m: number = 30
): TerrainGrid {
  const grid = createEmptyGrid(bbox, resolution_m);
  const corridors = corridorData?.corridors?.features || corridorData?.features || [];
  
  // Count corridor passages through each cell
  const countGrid = createEmptyGrid(bbox, resolution_m);
  const probGrid = createEmptyGrid(bbox, resolution_m);
  
  corridors.forEach((corridor: any) => {
    if (!corridor.geometry?.coordinates) return;
    const coords = corridor.geometry.coordinates;
    const prob = (corridor.properties?.probability || 50) / 100;
    
    coords.forEach((coord: number[]) => {
      const cell = coordToCell([coord[0], coord[1]], grid);
      if (cell) {
        countGrid.data[cell.row][cell.col] += 1;
        probGrid.data[cell.row][cell.col] = Math.max(probGrid.data[cell.row][cell.col], prob);
      }
    });
  });
  
  // Find max count for normalization
  let maxCount = 1;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      maxCount = Math.max(maxCount, countGrid.data[r][c]);
    }
  }
  
  // Compute convergence score: high count + high probability = convergence
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const countNorm = countGrid.data[r][c] / maxCount;
      const prob = probGrid.data[r][c];
      grid.data[r][c] = countNorm * 0.5 + prob * 0.5;
    }
  }
  
  return gaussianSmooth(grid, 2);
}

/**
 * Compute extreme slope penalty
 * Penalizes areas with very steep slopes
 */
export function computeExtremeSlopePenalty(
  corridorData: any,
  bbox: [number, number, number, number],
  resolution_m: number = 30
): TerrainGrid {
  const grid = createEmptyGrid(bbox, resolution_m);
  const corridors = corridorData?.corridors?.features || corridorData?.features || [];
  
  // Areas with high-probability corridors are NOT steep
  // So we invert corridor probability to estimate steepness
  corridors.forEach((corridor: any) => {
    if (!corridor.geometry?.coordinates) return;
    const coords = corridor.geometry.coordinates;
    const prob = (corridor.properties?.probability || 50) / 100;
    const avgSlope = corridor.properties?.avg_slope || 10;
    
    // Low probability + high slope = steep penalty
    let penalty = 0;
    if (avgSlope > SLOPE_BANDS.extreme_threshold) {
      penalty = 0.9;
    } else if (avgSlope > SLOPE_BANDS.penalty_threshold) {
      penalty = 0.5;
    } else {
      penalty = 0; // No penalty for moderate slopes
    }
    
    coords.forEach((coord: number[]) => {
      const cell = coordToCell([coord[0], coord[1]], grid);
      if (cell) {
        grid.data[cell.row][cell.col] = Math.max(grid.data[cell.row][cell.col], penalty * (1 - prob));
      }
    });
  });
  
  return gaussianSmooth(grid, 1);
}

/**
 * Compute cut/valley penalty
 * Penalizes deeply incised drainages
 */
export function computeCutPenalty(
  corridorData: any,
  bbox: [number, number, number, number],
  resolution_m: number = 30
): TerrainGrid {
  const grid = createEmptyGrid(bbox, resolution_m);
  // This is a placeholder - real implementation would use plan curvature
  // For now, areas with very low corridor probability are likely drainages
  const corridors = corridorData?.corridors?.features || corridorData?.features || [];
  
  // Start with moderate penalty everywhere
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      grid.data[r][c] = 0.3;
    }
  }
  
  // Remove penalty along corridors (corridors avoid drainages)
  corridors.forEach((corridor: any) => {
    if (!corridor.geometry?.coordinates) return;
    const coords = corridor.geometry.coordinates;
    const prob = (corridor.properties?.probability || 50) / 100;
    
    coords.forEach((coord: number[]) => {
      const cell = coordToCell([coord[0], coord[1]], grid);
      if (cell) {
        // High probability corridors reduce cut penalty
        grid.data[cell.row][cell.col] = Math.min(grid.data[cell.row][cell.col], 0.3 * (1 - prob));
      }
    });
  });
  
  return gaussianSmooth(grid, 2);
}

// ========== WEIGHTED LIKELIHOOD SURFACE ==========

/**
 * Compute combined terrain flow likelihood surface
 */
export function computeFlowLikelihood(
  components: ComponentRasters,
  weights: typeof TERRAIN_FLOW_WEIGHTS = TERRAIN_FLOW_WEIGHTS
): TerrainGrid | null {
  // Get first available grid for dimensions
  const templateGrid = components.slope_preference ||
    components.bench_likelihood ||
    components.terrain_convergence;
  
  if (!templateGrid) return null;
  
  const result = createEmptyGrid(templateGrid.bbox, templateGrid.resolution_m);
  
  for (let r = 0; r < result.rows; r++) {
    for (let c = 0; c < result.cols; c++) {
      let likelihood = 0;
      let totalWeight = 0;
      
      // Add positive components
      if (components.bench_likelihood) {
        const val = components.bench_likelihood.data[r]?.[c] || 0;
        likelihood += weights.bench_likelihood * val;
        totalWeight += weights.bench_likelihood;
      }
      
      if (components.saddle_proximity) {
        const val = components.saddle_proximity.data[r]?.[c] || 0;
        likelihood += weights.saddle_proximity * val;
        totalWeight += weights.saddle_proximity;
      }
      
      if (components.spine_proximity) {
        const val = components.spine_proximity.data[r]?.[c] || 0;
        likelihood += weights.spine_proximity * val;
        totalWeight += weights.spine_proximity;
      }
      
      if (components.terrain_convergence) {
        const val = components.terrain_convergence.data[r]?.[c] || 0;
        likelihood += weights.terrain_convergence * val;
        totalWeight += weights.terrain_convergence;
      }
      
      if (components.slope_preference) {
        const val = components.slope_preference.data[r]?.[c] || 0;
        likelihood += weights.moderate_slope * val;
        totalWeight += weights.moderate_slope;
      }
      
      // Subtract penalties
      if (components.extreme_slope_penalty) {
        const val = components.extreme_slope_penalty.data[r]?.[c] || 0;
        likelihood -= weights.extreme_slope_penalty * val;
      }
      
      if (components.cut_penalty) {
        const val = components.cut_penalty.data[r]?.[c] || 0;
        likelihood -= weights.cut_penalty * val;
      }
      
      // Normalize to 0-1
      if (totalWeight > 0) {
        result.data[r][c] = Math.max(0, Math.min(1, likelihood / totalWeight + 0.3));
      }
    }
  }
  
  return result;
}

// ========== FLOW LINE EXTRACTION ==========

/**
 * Extract flow lines from likelihood surface
 * Follows terrain structure, not parcel shape
 */
export function extractFlowLines(
  likelihoodGrid: TerrainGrid,
  corridorData: any,
  thresholds: typeof FLOW_THRESHOLDS = FLOW_THRESHOLDS
): {
  primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
  secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
} {
  const primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  const secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  
  // Extract from actual corridor geometries, weighted by likelihood
  const corridors = corridorData?.corridors?.features || corridorData?.features || [];
  
  corridors.forEach((corridor: any, idx: number) => {
    if (!corridor.geometry?.coordinates) return;
    const coords = corridor.geometry.coordinates;
    const prob = (corridor.properties?.probability || 50) / 100;
    
    // Sample likelihood along corridor
    let avgLikelihood = 0;
    let sampleCount = 0;
    
    coords.forEach((coord: number[]) => {
      const cell = coordToCell([coord[0], coord[1]], likelihoodGrid);
      if (cell) {
        avgLikelihood += likelihoodGrid.data[cell.row]?.[cell.col] || 0;
        sampleCount++;
      }
    });
    
    if (sampleCount > 0) {
      avgLikelihood /= sampleCount;
    }
    
    // Combine corridor probability with likelihood surface
    const combinedScore = prob * 0.4 + avgLikelihood * 0.6;
    
    // Calculate line length
    let lengthM = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      lengthM += distanceMeters(
        [coords[i][0], coords[i][1]],
        [coords[i + 1][0], coords[i + 1][1]]
      );
    }
    
    const tier: FlowTier = combinedScore >= thresholds.primary_percentile ? 'primary' : 'secondary';
    
    // Check length threshold
    const minLength = tier === 'primary' 
      ? thresholds.min_length_m_primary 
      : thresholds.min_length_m_secondary;
    
    if (lengthM < minLength) return;
    if (combinedScore < thresholds.secondary_percentile) return;
    
    const feature: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties> = {
      type: 'Feature',
      properties: {
        id: `flow_${tier}_${idx}`,
        tier,
        likelihood: combinedScore,
        lengthM: Math.round(lengthM),
        avgSlope: corridor.properties?.avg_slope || 10,
        convergenceScore: prob,
      },
      geometry: {
        type: 'LineString',
        coordinates: coords.map((c: number[]) => [c[0], c[1]]),
      },
    };
    
    if (tier === 'primary') {
      primary.push(feature);
    } else {
      secondary.push(feature);
    }
  });
  
  // Sort by likelihood
  primary.sort((a, b) => b.properties.likelihood - a.properties.likelihood);
  secondary.sort((a, b) => b.properties.likelihood - a.properties.likelihood);
  
  return { primary, secondary };
}

// ========== CONVERGENCE ZONE DETECTION ==========

/**
 * Scaling options for convergence/opportunity zone detection
 * Used to adapt feature sizes to parcel dimensions
 */
export interface ZoneScalingOptions {
  searchRadius?: number;       // Radius for nearby flow search (default 100m)
  baseRadius?: number;         // Base convergence zone display radius (default 30m)
  maxZones?: number;           // Max convergence zones to return (default 5)
  smoothingCells?: number;     // Gaussian smoothing kernel radius (default 3)
  opportunityRadius?: number;  // Opportunity zone radius (default 25m)
  maxOpportunityZones?: number; // Max opportunity zones (default 3)
}

const DEFAULT_ZONE_SCALING: Required<ZoneScalingOptions> = {
  searchRadius: 100,
  baseRadius: 30,
  maxZones: 5,
  smoothingCells: 3,
  opportunityRadius: 25,
  maxOpportunityZones: 3,
};

/**
 * Identify convergence zones from terrain structure (not endpoint clustering)
 * Uses flow density, terrain pinches, and saddle proximity
 * 
 * @param likelihoodGrid - Terrain flow likelihood surface
 * @param flowLines - Extracted primary and secondary flow lines
 * @param thresholds - Flow extraction thresholds
 * @param scalingOptions - Parcel-adaptive scaling parameters
 */
export function identifyConvergenceZones(
  likelihoodGrid: TerrainGrid,
  flowLines: {
    primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
    secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
  },
  thresholds: typeof FLOW_THRESHOLDS = FLOW_THRESHOLDS,
  scalingOptions: ZoneScalingOptions = {}
): GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[] {
  // Merge with defaults
  const opts = { ...DEFAULT_ZONE_SCALING, ...scalingOptions };
  
  const zones: GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[] = [];
  
  // Build flow density grid
  const densityGrid = createEmptyGrid(likelihoodGrid.bbox, likelihoodGrid.resolution_m);
  
  const allFlows = [...flowLines.primary, ...flowLines.secondary];
  
  allFlows.forEach(flow => {
    const coords = flow.geometry.coordinates;
    coords.forEach(coord => {
      const cell = coordToCell([coord[0], coord[1]], densityGrid);
      if (cell) {
        densityGrid.data[cell.row][cell.col] += flow.properties.likelihood;
      }
    });
  });
  
  // Smooth and find local maxima (scaling-aware smoothing radius)
  const smoothedDensity = gaussianSmooth(densityGrid, opts.smoothingCells);
  
  // Find cells that are local maxima and above threshold
  const maxima: { row: number; col: number; value: number }[] = [];
  
  for (let r = 2; r < smoothedDensity.rows - 2; r++) {
    for (let c = 2; c < smoothedDensity.cols - 2; c++) {
      const val = smoothedDensity.data[r][c];
      if (val < thresholds.convergence_threshold) continue;
      
      // Check if local maximum (3x3 neighborhood)
      let isMax = true;
      for (let dr = -1; dr <= 1 && isMax; dr++) {
        for (let dc = -1; dc <= 1 && isMax; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (smoothedDensity.data[r + dr]?.[c + dc] >= val) {
            isMax = false;
          }
        }
      }
      
      if (isMax) {
        maxima.push({ row: r, col: c, value: val });
      }
    }
  }
  
  // Sort by value and take top convergence zones (SCALED max count)
  maxima.sort((a, b) => b.value - a.value);
  const topZones = maxima.slice(0, opts.maxZones);
  
  topZones.forEach((max, idx) => {
    const coord = cellToCoord(max.row, max.col, smoothedDensity);
    
    // Count nearby flows using SCALED search radius
    let flowCount = 0;
    allFlows.forEach(flow => {
      const coords = flow.geometry.coordinates;
      for (const c of coords) {
        if (distanceMeters([c[0], c[1]], coord) < opts.searchRadius) {
          flowCount++;
          break;
        }
      }
    });
    
    // SCALED radius: base + flow-count bonus
    const scaledRadius = opts.baseRadius + flowCount * (opts.baseRadius / 3);
    
    zones.push({
      type: 'Feature',
      properties: {
        id: `conv_${idx}`,
        intensity: Math.min(1, max.value),
        flowCount: Math.max(2, flowCount),
        radiusM: Math.round(scaledRadius),
        type: flowCount >= 3 ? 'pinch' : 'overlap',
      },
      geometry: {
        type: 'Point',
        coordinates: coord,
      },
    });
  });
  
  return zones;
}

/**
 * Identify opportunity zones at high-convergence + high-likelihood areas
 * 
 * @param convergenceZones - Detected convergence zones
 * @param likelihoodGrid - Terrain flow likelihood surface
 * @param thresholds - Flow extraction thresholds
 * @param scalingOptions - Parcel-adaptive scaling parameters
 */
export function identifyOpportunityZones(
  convergenceZones: GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[],
  likelihoodGrid: TerrainGrid,
  thresholds: typeof FLOW_THRESHOLDS = FLOW_THRESHOLDS,
  scalingOptions: ZoneScalingOptions = {}
): GeoJSON.Feature<GeoJSON.Point, OpportunityZoneProperties>[] {
  // Merge with defaults
  const opts = { ...DEFAULT_ZONE_SCALING, ...scalingOptions };
  
  const zones: GeoJSON.Feature<GeoJSON.Point, OpportunityZoneProperties>[] = [];
  
  // Filter high-intensity convergence zones
  const highIntensity = convergenceZones.filter(
    z => z.properties.intensity >= thresholds.opportunity_threshold
  );
  
  // Use SCALED max opportunity zone count
  highIntensity.slice(0, opts.maxOpportunityZones).forEach((conv, i) => {
    const coord = conv.geometry.coordinates as [number, number];
    const cell = coordToCell(coord, likelihoodGrid);
    const localLikelihood = cell ? likelihoodGrid.data[cell.row]?.[cell.col] || 0.5 : 0.5;
    
    zones.push({
      type: 'Feature',
      properties: {
        id: `opp_${i}`,
        score: conv.properties.intensity * 0.7 + localLikelihood * 0.3,
        flowIntensity: conv.properties.intensity * 0.7,
        convergenceBonus: 0.15 * conv.properties.flowCount / 3,
        benchBonus: 0.10,
        saddleBonus: conv.properties.type === 'pinch' ? 0.10 : 0.05,
        radiusM: opts.opportunityRadius, // SCALED opportunity radius
      },
      geometry: conv.geometry,
    });
  });
  
  return zones;
}

// ========== SMOOTHING UTILITIES ==========

/**
 * Apply Gaussian smoothing to grid
 */
function gaussianSmooth(grid: TerrainGrid, radius: number): TerrainGrid {
  const result = createEmptyGrid(grid.bbox, grid.resolution_m);
  
  // Generate Gaussian kernel
  const size = radius * 2 + 1;
  const kernel: number[][] = [];
  let sum = 0;
  
  for (let i = 0; i < size; i++) {
    kernel[i] = [];
    for (let j = 0; j < size; j++) {
      const x = i - radius;
      const y = j - radius;
      const value = Math.exp(-(x * x + y * y) / (2 * radius * radius));
      kernel[i][j] = value;
      sum += value;
    }
  }
  
  // Normalize kernel
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      kernel[i][j] /= sum;
    }
  }
  
  // Apply kernel
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      let val = 0;
      for (let ki = 0; ki < size; ki++) {
        for (let kj = 0; kj < size; kj++) {
          const gr = r + ki - radius;
          const gc = c + kj - radius;
          if (gr >= 0 && gr < grid.rows && gc >= 0 && gc < grid.cols) {
            val += grid.data[gr][gc] * kernel[ki][kj];
          }
        }
      }
      result.data[r][c] = val;
    }
  }
  
  return result;
}

/**
 * Convert grid to GeoJSON for debug visualization
 */
export function gridToGeoJSON(
  grid: TerrainGrid,
  name: string
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  
  // Sample grid at lower resolution for visualization
  const step = Math.max(1, Math.floor(Math.min(grid.rows, grid.cols) / 30));
  
  for (let r = 0; r < grid.rows; r += step) {
    for (let c = 0; c < grid.cols; c += step) {
      const value = grid.data[r][c];
      if (value < 0.1) continue; // Skip low values
      
      const coord = cellToCoord(r, c, grid);
      
      features.push({
        type: 'Feature',
        properties: {
          value,
          layer: name,
        },
        geometry: {
          type: 'Point',
          coordinates: coord,
        },
      });
    }
  }
  
  return {
    type: 'FeatureCollection',
    features,
  };
}
