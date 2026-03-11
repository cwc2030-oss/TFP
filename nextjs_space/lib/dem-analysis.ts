/**
 * DEM Analysis Library
 * 
 * Real terrain analysis from Digital Elevation Model (DEM) data.
 * Computes slope, curvature, ridges, saddles, and benches directly from elevation.
 * 
 * This is the foundation for TRULY DEM-driven terrain flow analysis.
 * 
 * Key Computations:
 * 1. Slope: Gradient magnitude from finite differences (degrees)
 * 2. Aspect: Downslope direction (0-360°)
 * 3. Profile Curvature: Curvature in direction of steepest descent (convex/concave)
 * 4. Plan Curvature: Curvature perpendicular to slope (convergent/divergent)
 * 5. Ridge Detection: Local maxima along profile curvature
 * 6. Saddle Detection: Mixed curvature signature (convex one direction, concave other)
 * 7. Bench Detection: Low slope + high plan curvature (sidehill flats)
 */

import {
  TerrainGrid,
  createEmptyGrid,
  coordToCell,
  cellToCoord,
  distanceMeters,
  getBbox,
  SLOPE_BANDS,
} from './terrain-analysis';

// ========== DEM GRID TYPES ==========

export interface DEMGrid extends TerrainGrid {
  elevation_m: number[][];      // Raw elevation in meters
  cellSizeM: number;            // Cell size in meters (computed)
  noDataValue: number;          // No-data sentinel
}

export interface SlopeAspectGrid {
  slope: TerrainGrid;           // Slope in degrees (0-90)
  aspect: TerrainGrid;          // Aspect in degrees (0-360, N=0)
}

export interface CurvatureGrid {
  profile: TerrainGrid;         // Profile curvature (+ = convex/ridge, - = concave/valley)
  plan: TerrainGrid;            // Plan curvature (+ = divergent, - = convergent)
  mean: TerrainGrid;            // Mean curvature
}

export interface TerrainFeaturePoint {
  coord: [number, number];
  row: number;
  col: number;
  value: number;
  type: 'ridge' | 'saddle' | 'bench' | 'drainage';
  confidence: number;
}

// ========== COMPONENT SCORE TYPES ==========

export interface FlowSegmentScores {
  segmentId: string;
  coordinates: [number, number][];
  scores: {
    slope_preference: number;
    bench_likelihood: number;
    saddle_proximity: number;
    spine_proximity: number;
    terrain_convergence: number;
    extreme_slope_penalty: number;
    cut_penalty: number;
    total_likelihood: number;
  };
  // Per-point breakdown for visualization
  pointScores: Array<{
    coord: [number, number];
    slope_deg: number;
    profile_curv: number;
    plan_curv: number;
    bench: number;
    saddle: number;
    spine: number;
    convergence: number;
    penalty: number;
    likelihood: number;
  }>;
}

// ========== DEM GRID CREATION ==========

/**
 * Create DEM grid from corridor API metadata
 * The corridor API includes elevation samples we can use
 */
export function createDEMFromCorridorData(
  corridorData: any,
  bbox: [number, number, number, number],
  resolution_m: number = 30
): DEMGrid | null {
  if (!corridorData) return null;
  
  const grid = createEmptyGrid(bbox, resolution_m);
  const elevationGrid: number[][] = Array(grid.rows)
    .fill(null)
    .map(() => Array(grid.cols).fill(-9999)); // No-data value
  
  // Extract elevation from corridor vertices
  const corridors = corridorData?.corridors?.features || corridorData?.features || [];
  
  corridors.forEach((corridor: any) => {
    if (!corridor.geometry?.coordinates) return;
    const coords = corridor.geometry.coordinates;
    
    coords.forEach((coord: number[]) => {
      const cell = coordToCell([coord[0], coord[1]], grid);
      if (cell && coord[2] !== undefined) {
        // coord[2] is elevation if provided
        if (elevationGrid[cell.row][cell.col] === -9999) {
          elevationGrid[cell.row][cell.col] = coord[2];
        }
      }
    });
  });
  
  // Interpolate missing values using IDW
  interpolateMissingElevation(elevationGrid, grid.rows, grid.cols);
  
  return {
    ...grid,
    elevation_m: elevationGrid,
    cellSizeM: resolution_m,
    noDataValue: -9999,
  };
}

/**
 * Create DEM grid from elevation samples
 */
export function createDEMFromSamples(
  samples: Array<{ coord: [number, number]; elevation_m: number }>,
  bbox: [number, number, number, number],
  resolution_m: number = 30
): DEMGrid | null {
  if (samples.length < 10) return null;
  
  const grid = createEmptyGrid(bbox, resolution_m);
  const elevationGrid: number[][] = Array(grid.rows)
    .fill(null)
    .map(() => Array(grid.cols).fill(-9999));
  
  // Place samples
  samples.forEach(sample => {
    const cell = coordToCell(sample.coord, grid);
    if (cell) {
      elevationGrid[cell.row][cell.col] = sample.elevation_m;
    }
  });
  
  // Interpolate
  interpolateMissingElevation(elevationGrid, grid.rows, grid.cols);
  
  return {
    ...grid,
    elevation_m: elevationGrid,
    cellSizeM: resolution_m,
    noDataValue: -9999,
  };
}

/**
 * Interpolate missing elevation values using inverse distance weighting
 */
function interpolateMissingElevation(
  grid: number[][],
  rows: number,
  cols: number,
  searchRadius: number = 5
): void {
  const noData = -9999;
  
  // Collect known points
  const knownPoints: Array<{ r: number; c: number; elev: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== noData) {
        knownPoints.push({ r, c, elev: grid[r][c] });
      }
    }
  }
  
  if (knownPoints.length === 0) {
    // No known points, fill with default (e.g., 300m for Missouri terrain)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        grid[r][c] = 300;
      }
    }
    return;
  }
  
  // IDW interpolation for missing cells
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== noData) continue;
      
      // Find nearby known points
      let weightedSum = 0;
      let weightSum = 0;
      
      knownPoints.forEach(kp => {
        const dist = Math.sqrt((r - kp.r) ** 2 + (c - kp.c) ** 2);
        if (dist < searchRadius && dist > 0) {
          const weight = 1 / (dist * dist);
          weightedSum += kp.elev * weight;
          weightSum += weight;
        } else if (dist === 0) {
          weightedSum = kp.elev;
          weightSum = 1;
        }
      });
      
      if (weightSum > 0) {
        grid[r][c] = weightedSum / weightSum;
      } else {
        // Use nearest neighbor
        let minDist = Infinity;
        let nearest = knownPoints[0].elev;
        knownPoints.forEach(kp => {
          const dist = Math.sqrt((r - kp.r) ** 2 + (c - kp.c) ** 2);
          if (dist < minDist) {
            minDist = dist;
            nearest = kp.elev;
          }
        });
        grid[r][c] = nearest;
      }
    }
  }
}

// ========== SLOPE AND ASPECT COMPUTATION ==========

/**
 * Compute slope and aspect from DEM using Horn's method (3x3 finite differences)
 * This is the standard ESRI/GDAL algorithm for slope computation
 */
export function computeSlopeAspect(dem: DEMGrid): SlopeAspectGrid {
  const slopeGrid = createEmptyGrid(dem.bbox, dem.resolution_m);
  const aspectGrid = createEmptyGrid(dem.bbox, dem.resolution_m);
  
  for (let r = 1; r < dem.rows - 1; r++) {
    for (let c = 1; c < dem.cols - 1; c++) {
      // Horn's 3x3 gradient calculation
      // Weights: corners=1, edges=2
      const z1 = dem.elevation_m[r - 1][c - 1]; // NW
      const z2 = dem.elevation_m[r - 1][c];     // N
      const z3 = dem.elevation_m[r - 1][c + 1]; // NE
      const z4 = dem.elevation_m[r][c - 1];     // W
      const z6 = dem.elevation_m[r][c + 1];     // E
      const z7 = dem.elevation_m[r + 1][c - 1]; // SW
      const z8 = dem.elevation_m[r + 1][c];     // S
      const z9 = dem.elevation_m[r + 1][c + 1]; // SE
      
      // E-W gradient (dz/dx)
      const dzdx = ((z3 + 2 * z6 + z9) - (z1 + 2 * z4 + z7)) / (8 * dem.cellSizeM);
      
      // N-S gradient (dz/dy)
      const dzdy = ((z7 + 2 * z8 + z9) - (z1 + 2 * z2 + z3)) / (8 * dem.cellSizeM);
      
      // Slope in degrees
      const slopeDeg = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * (180 / Math.PI);
      slopeGrid.data[r][c] = slopeDeg;
      
      // Aspect in degrees (0=N, 90=E, 180=S, 270=W)
      let aspect = 0;
      if (dzdx !== 0 || dzdy !== 0) {
        aspect = Math.atan2(dzdx, -dzdy) * (180 / Math.PI);
        if (aspect < 0) aspect += 360;
      }
      aspectGrid.data[r][c] = aspect;
    }
  }
  
  return { slope: slopeGrid, aspect: aspectGrid };
}

/**
 * Compute true slope preference surface from DEM
 * Optimal: 5-15° (energy-efficient travel)
 * Good: 2-25°
 * Penalized: >25° (steep), <2° (often wet/boggy)
 */
export function computeTrueSlopePreference(dem: DEMGrid): TerrainGrid {
  const { slope } = computeSlopeAspect(dem);
  const prefGrid = createEmptyGrid(dem.bbox, dem.resolution_m);
  
  for (let r = 0; r < prefGrid.rows; r++) {
    for (let c = 0; c < prefGrid.cols; c++) {
      const slopeDeg = slope.data[r]?.[c] || 0;
      
      let preference = 0;
      if (slopeDeg >= SLOPE_BANDS.optimal_min && slopeDeg <= SLOPE_BANDS.optimal_max) {
        // Optimal slope range (5-15°)
        preference = 1.0;
      } else if (slopeDeg >= SLOPE_BANDS.acceptable_min && slopeDeg < SLOPE_BANDS.optimal_min) {
        // Too flat but acceptable (2-5°)
        preference = 0.5 + 0.5 * (slopeDeg - SLOPE_BANDS.acceptable_min) / 
                    (SLOPE_BANDS.optimal_min - SLOPE_BANDS.acceptable_min);
      } else if (slopeDeg > SLOPE_BANDS.optimal_max && slopeDeg <= SLOPE_BANDS.acceptable_max) {
        // Getting steep but acceptable (15-25°)
        preference = 1.0 - 0.4 * (slopeDeg - SLOPE_BANDS.optimal_max) / 
                    (SLOPE_BANDS.acceptable_max - SLOPE_BANDS.optimal_max);
      } else if (slopeDeg < SLOPE_BANDS.acceptable_min) {
        // Too flat (often wet)
        preference = 0.3;
      } else if (slopeDeg <= SLOPE_BANDS.penalty_threshold) {
        // Steep (25-35°)
        preference = 0.3 - 0.2 * (slopeDeg - SLOPE_BANDS.acceptable_max) / 
                    (SLOPE_BANDS.penalty_threshold - SLOPE_BANDS.acceptable_max);
      } else {
        // Very steep (>35°)
        preference = 0.1;
      }
      
      prefGrid.data[r][c] = Math.max(0, Math.min(1, preference));
    }
  }
  
  return prefGrid;
}

// ========== CURVATURE COMPUTATION ==========

/**
 * Compute profile and plan curvature from DEM
 * 
 * Profile curvature: Rate of change of slope along flow direction
 *   + = convex (ridge-like)
 *   - = concave (valley-like)
 * 
 * Plan curvature: Rate of change of aspect perpendicular to slope
 *   + = divergent (nose/ridge)
 *   - = convergent (hollow/drainage)
 */
export function computeCurvature(dem: DEMGrid): CurvatureGrid {
  const profileGrid = createEmptyGrid(dem.bbox, dem.resolution_m);
  const planGrid = createEmptyGrid(dem.bbox, dem.resolution_m);
  const meanGrid = createEmptyGrid(dem.bbox, dem.resolution_m);
  
  const cs = dem.cellSizeM; // cell size
  
  for (let r = 1; r < dem.rows - 1; r++) {
    for (let c = 1; c < dem.cols - 1; c++) {
      // 3x3 neighborhood
      const z1 = dem.elevation_m[r - 1][c - 1]; // NW
      const z2 = dem.elevation_m[r - 1][c];     // N
      const z3 = dem.elevation_m[r - 1][c + 1]; // NE
      const z4 = dem.elevation_m[r][c - 1];     // W
      const z5 = dem.elevation_m[r][c];         // Center
      const z6 = dem.elevation_m[r][c + 1];     // E
      const z7 = dem.elevation_m[r + 1][c - 1]; // SW
      const z8 = dem.elevation_m[r + 1][c];     // S
      const z9 = dem.elevation_m[r + 1][c + 1]; // SE
      
      // First derivatives
      const p = (z6 - z4) / (2 * cs);  // dz/dx
      const q = (z2 - z8) / (2 * cs);  // dz/dy
      
      // Second derivatives
      const r2 = (z6 - 2 * z5 + z4) / (cs * cs);  // d2z/dx2
      const t = (z2 - 2 * z5 + z8) / (cs * cs);  // d2z/dy2
      const s = (z3 - z1 - z9 + z7) / (4 * cs * cs); // d2z/dxdy
      
      // Gradient squared
      const gradSq = p * p + q * q;
      
      if (gradSq > 0.0001) {
        // Profile curvature (in direction of steepest descent)
        const profileCurv = -(r2 * p * p + 2 * s * p * q + t * q * q) / 
                           (gradSq * Math.pow(1 + gradSq, 1.5));
        
        // Plan curvature (perpendicular to slope)
        const planCurv = -(r2 * q * q - 2 * s * p * q + t * p * p) / 
                        (gradSq * Math.pow(1 + gradSq, 0.5));
        
        // Scale and normalize to reasonable range (-1 to 1)
        profileGrid.data[r][c] = Math.max(-1, Math.min(1, profileCurv * 100));
        planGrid.data[r][c] = Math.max(-1, Math.min(1, planCurv * 100));
        meanGrid.data[r][c] = (profileGrid.data[r][c] + planGrid.data[r][c]) / 2;
      }
    }
  }
  
  return { profile: profileGrid, plan: planGrid, mean: meanGrid };
}

// ========== BENCH DETECTION ==========

/**
 * Detect benches: flat areas on hillsides (sidehill travel corridors)
 * Characteristics:
 * - Low slope (2-10°)
 * - High (negative) plan curvature (convergent, water collects)
 * - Moderate profile curvature (not on ridge or in valley bottom)
 */
export function detectBenches(dem: DEMGrid): TerrainGrid {
  const { slope } = computeSlopeAspect(dem);
  const curvature = computeCurvature(dem);
  
  const benchGrid = createEmptyGrid(dem.bbox, dem.resolution_m);
  
  for (let r = 0; r < benchGrid.rows; r++) {
    for (let c = 0; c < benchGrid.cols; c++) {
      const slopeDeg = slope.data[r]?.[c] || 0;
      const profileCurv = curvature.profile.data[r]?.[c] || 0;
      const planCurv = curvature.plan.data[r]?.[c] || 0;
      
      // Bench criteria:
      // 1. Low-moderate slope (2-15°) - flat enough to travel
      // 2. NOT on ridge top (profile curv not too positive)
      // 3. Convergent plan curvature (bench collects flow from above)
      
      let benchScore = 0;
      
      // Slope component (optimal 3-10°)
      if (slopeDeg >= 3 && slopeDeg <= 10) {
        benchScore += 0.4; // Optimal bench slope
      } else if (slopeDeg >= 2 && slopeDeg <= 15) {
        benchScore += 0.25; // Acceptable
      } else if (slopeDeg < 2) {
        benchScore += 0.1; // Too flat (bottom)
      } else if (slopeDeg <= 20) {
        benchScore += 0.15; // Getting steep
      }
      
      // Plan curvature component (negative = convergent = bench-like)
      if (planCurv < -0.2) {
        benchScore += 0.35; // Strongly convergent (good bench indicator)
      } else if (planCurv < 0) {
        benchScore += 0.2; // Mildly convergent
      } else if (planCurv < 0.1) {
        benchScore += 0.1; // Nearly flat
      }
      
      // Profile curvature component (slightly negative = sidehill, not ridge)
      if (profileCurv >= -0.3 && profileCurv <= 0.2) {
        benchScore += 0.25; // Sidehill position (ideal)
      } else if (profileCurv > 0.2) {
        benchScore += 0.05; // Ridge-like (not bench)
      } else if (profileCurv < -0.3) {
        benchScore += 0.1; // Valley-like (drainage, not bench)
      }
      
      benchGrid.data[r][c] = Math.min(1, benchScore);
    }
  }
  
  return benchGrid;
}

// ========== RIDGE DETECTION ==========

/**
 * Detect ridges from DEM using profile curvature
 * Ridges have positive profile curvature (convex) and are local elevation maxima
 */
export function detectRidges(dem: DEMGrid): {
  ridgeGrid: TerrainGrid;
  ridgePoints: TerrainFeaturePoint[];
} {
  const curvature = computeCurvature(dem);
  const ridgeGrid = createEmptyGrid(dem.bbox, dem.resolution_m);
  const ridgePoints: TerrainFeaturePoint[] = [];
  
  for (let r = 2; r < dem.rows - 2; r++) {
    for (let c = 2; c < dem.cols - 2; c++) {
      const elev = dem.elevation_m[r][c];
      const profileCurv = curvature.profile.data[r]?.[c] || 0;
      const planCurv = curvature.plan.data[r]?.[c] || 0;
      
      // Ridge criteria:
      // 1. Positive profile curvature (convex)
      // 2. Local elevation maximum in perpendicular direction
      // 3. Positive plan curvature (divergent)
      
      let ridgeScore = 0;
      
      // Profile curvature (convex = ridge)
      if (profileCurv > 0.3) {
        ridgeScore += 0.5;
      } else if (profileCurv > 0.1) {
        ridgeScore += 0.3;
      } else if (profileCurv > 0) {
        ridgeScore += 0.15;
      }
      
      // Plan curvature (divergent = nose/ridge)
      if (planCurv > 0.2) {
        ridgeScore += 0.3;
      } else if (planCurv > 0) {
        ridgeScore += 0.15;
      }
      
      // Local maximum check (perpendicular to ridge)
      const neighbors = [
        dem.elevation_m[r - 1]?.[c],
        dem.elevation_m[r + 1]?.[c],
        dem.elevation_m[r]?.[c - 1],
        dem.elevation_m[r]?.[c + 1],
      ].filter(e => e !== undefined);
      
      const lowerCount = neighbors.filter(n => n < elev).length;
      if (lowerCount >= 3) {
        ridgeScore += 0.2; // Mostly higher than neighbors
      } else if (lowerCount >= 2) {
        ridgeScore += 0.1;
      }
      
      ridgeGrid.data[r][c] = Math.min(1, ridgeScore);
      
      // Extract significant ridge points
      if (ridgeScore > 0.6) {
        const coord = cellToCoord(r, c, ridgeGrid);
        ridgePoints.push({
          coord,
          row: r,
          col: c,
          value: ridgeScore,
          type: 'ridge',
          confidence: ridgeScore,
        });
      }
    }
  }
  
  return { ridgeGrid, ridgePoints };
}

// ========== SADDLE DETECTION ==========

/**
 * Detect saddles: low points on ridges where terrain crosses
 * Characteristics:
 * - Local elevation minimum along ridge (profile direction)
 * - Local elevation maximum across ridge (perpendicular)
 * - Mixed curvature signature (convex one direction, concave other)
 */
export function detectSaddles(dem: DEMGrid): {
  saddleGrid: TerrainGrid;
  saddlePoints: TerrainFeaturePoint[];
} {
  const curvature = computeCurvature(dem);
  const saddleGrid = createEmptyGrid(dem.bbox, dem.resolution_m);
  const saddlePoints: TerrainFeaturePoint[] = [];
  
  for (let r = 2; r < dem.rows - 2; r++) {
    for (let c = 2; c < dem.cols - 2; c++) {
      const elev = dem.elevation_m[r][c];
      const profileCurv = curvature.profile.data[r]?.[c] || 0;
      const planCurv = curvature.plan.data[r]?.[c] || 0;
      
      // Saddle criteria:
      // 1. Mixed curvature (positive in one direction, negative in other)
      // 2. Not extremely steep
      
      let saddleScore = 0;
      
      // Mixed curvature is key indicator of saddle
      const curvProduct = profileCurv * planCurv;
      if (curvProduct < -0.1) {
        // Opposite signs = saddle-like
        saddleScore += 0.5 * Math.min(1, Math.abs(curvProduct) * 5);
      }
      
      // Check local min/max pattern in 4 directions
      const ns = [dem.elevation_m[r - 1]?.[c], dem.elevation_m[r + 1]?.[c]];
      const ew = [dem.elevation_m[r]?.[c - 1], dem.elevation_m[r]?.[c + 1]];
      
      const nsValid = ns.every(e => e !== undefined);
      const ewValid = ew.every(e => e !== undefined);
      
      if (nsValid && ewValid) {
        const isMinNS = elev < ns[0]! && elev < ns[1]!;
        const isMaxNS = elev > ns[0]! && elev > ns[1]!;
        const isMinEW = elev < ew[0]! && elev < ew[1]!;
        const isMaxEW = elev > ew[0]! && ew[1]! && elev > ew[1]!;
        
        if ((isMinNS && isMaxEW) || (isMaxNS && isMinEW)) {
          saddleScore += 0.4; // Classic saddle pattern
        } else if (isMinNS || isMinEW) {
          saddleScore += 0.1; // Partial saddle
        }
      }
      
      // Saddles often have low curvature magnitude in profile direction
      if (Math.abs(profileCurv) < 0.2) {
        saddleScore += 0.1;
      }
      
      saddleGrid.data[r][c] = Math.min(1, saddleScore);
      
      // Extract significant saddle points
      if (saddleScore > 0.5) {
        const coord = cellToCoord(r, c, saddleGrid);
        saddlePoints.push({
          coord,
          row: r,
          col: c,
          value: saddleScore,
          type: 'saddle',
          confidence: saddleScore,
        });
      }
    }
  }
  
  return { saddleGrid, saddlePoints };
}

// ========== DRAINAGE DETECTION ==========

/**
 * Detect drainages/valleys: convergent areas where water collects
 * Used for cut_penalty computation
 */
export function detectDrainages(dem: DEMGrid): TerrainGrid {
  const curvature = computeCurvature(dem);
  const drainageGrid = createEmptyGrid(dem.bbox, dem.resolution_m);
  
  for (let r = 0; r < drainageGrid.rows; r++) {
    for (let c = 0; c < drainageGrid.cols; c++) {
      const profileCurv = curvature.profile.data[r]?.[c] || 0;
      const planCurv = curvature.plan.data[r]?.[c] || 0;
      
      // Drainage criteria:
      // 1. Negative profile curvature (concave)
      // 2. Negative plan curvature (convergent)
      
      let drainageScore = 0;
      
      if (profileCurv < -0.2) {
        drainageScore += 0.4; // Concave (valley-like)
      } else if (profileCurv < 0) {
        drainageScore += 0.2;
      }
      
      if (planCurv < -0.3) {
        drainageScore += 0.5; // Strongly convergent
      } else if (planCurv < 0) {
        drainageScore += 0.25;
      }
      
      drainageGrid.data[r][c] = Math.min(1, drainageScore);
    }
  }
  
  return drainageGrid;
}

// ========== FLOW SEGMENT SCORING ==========

/**
 * Compute component scores for a flow segment
 * This explains WHY a flow path exists at each location
 */
export function computeFlowSegmentScores(
  segmentId: string,
  coordinates: [number, number][],
  dem: DEMGrid | null,
  components: {
    slope_preference?: TerrainGrid;
    bench_likelihood?: TerrainGrid;
    saddle_proximity?: TerrainGrid;
    spine_proximity?: TerrainGrid;
    terrain_convergence?: TerrainGrid;
    extreme_slope_penalty?: TerrainGrid;
    cut_penalty?: TerrainGrid;
    flow_likelihood?: TerrainGrid;
  }
): FlowSegmentScores {
  const { slope } = dem ? computeSlopeAspect(dem) : { slope: null };
  const curvature = dem ? computeCurvature(dem) : null;
  
  // Aggregate scores
  let totalSlope = 0, totalBench = 0, totalSaddle = 0, totalSpine = 0;
  let totalConvergence = 0, totalPenalty = 0, totalCut = 0, totalLikelihood = 0;
  let count = 0;
  
  const pointScores: FlowSegmentScores['pointScores'] = [];
  
  coordinates.forEach(coord => {
    // Get grid cell for each coordinate
    const cell = components.slope_preference 
      ? coordToCell(coord, components.slope_preference)
      : null;
    
    if (!cell) {
      // Default scores if outside grid
      pointScores.push({
        coord,
        slope_deg: 10,
        profile_curv: 0,
        plan_curv: 0,
        bench: 0.3,
        saddle: 0.2,
        spine: 0.2,
        convergence: 0.3,
        penalty: 0.1,
        likelihood: 0.5,
      });
      return;
    }
    
    const { row, col } = cell;
    
    // Extract values from each component grid
    const slopePref = components.slope_preference?.data[row]?.[col] || 0.3;
    const bench = components.bench_likelihood?.data[row]?.[col] || 0.3;
    const saddle = components.saddle_proximity?.data[row]?.[col] || 0.2;
    const spine = components.spine_proximity?.data[row]?.[col] || 0.2;
    const convergence = components.terrain_convergence?.data[row]?.[col] || 0.3;
    const extremePenalty = components.extreme_slope_penalty?.data[row]?.[col] || 0;
    const cutPenalty = components.cut_penalty?.data[row]?.[col] || 0.1;
    const likelihood = components.flow_likelihood?.data[row]?.[col] || 0.5;
    
    // Get raw terrain values if DEM available
    const slopeDeg = slope?.data[row]?.[col] || 10;
    const profileCurv = curvature?.profile?.data[row]?.[col] || 0;
    const planCurv = curvature?.plan?.data[row]?.[col] || 0;
    
    pointScores.push({
      coord,
      slope_deg: slopeDeg,
      profile_curv: profileCurv,
      plan_curv: planCurv,
      bench,
      saddle,
      spine,
      convergence,
      penalty: extremePenalty + cutPenalty,
      likelihood,
    });
    
    totalSlope += slopePref;
    totalBench += bench;
    totalSaddle += saddle;
    totalSpine += spine;
    totalConvergence += convergence;
    totalPenalty += extremePenalty;
    totalCut += cutPenalty;
    totalLikelihood += likelihood;
    count++;
  });
  
  const n = Math.max(1, count);
  
  return {
    segmentId,
    coordinates,
    scores: {
      slope_preference: totalSlope / n,
      bench_likelihood: totalBench / n,
      saddle_proximity: totalSaddle / n,
      spine_proximity: totalSpine / n,
      terrain_convergence: totalConvergence / n,
      extreme_slope_penalty: totalPenalty / n,
      cut_penalty: totalCut / n,
      total_likelihood: totalLikelihood / n,
    },
    pointScores,
  };
}

// ========== PROXIMITY SURFACES ==========

/**
 * Compute spine proximity from detected ridges
 */
export function computeSpineProximityFromDEM(
  dem: DEMGrid,
  maxDistanceM: number = 200
): TerrainGrid {
  const { ridgeGrid, ridgePoints } = detectRidges(dem);
  const proximityGrid = createEmptyGrid(dem.bbox, dem.resolution_m);
  
  // For each cell, compute distance to nearest ridge point
  for (let r = 0; r < proximityGrid.rows; r++) {
    for (let c = 0; c < proximityGrid.cols; c++) {
      if (ridgePoints.length === 0) {
        // No ridges detected, use ridge grid value directly
        proximityGrid.data[r][c] = ridgeGrid.data[r]?.[c] || 0.2;
        continue;
      }
      
      const coord = cellToCoord(r, c, proximityGrid);
      let minDist = Infinity;
      let nearestRidgeScore = 0;
      
      ridgePoints.forEach(rp => {
        const dist = distanceMeters(coord, rp.coord);
        if (dist < minDist) {
          minDist = dist;
          nearestRidgeScore = rp.value;
        }
      });
      
      if (minDist < maxDistanceM) {
        // Distance decay with ridge confidence
        const decay = 1 - (minDist / maxDistanceM);
        proximityGrid.data[r][c] = nearestRidgeScore * decay * decay;
      } else {
        proximityGrid.data[r][c] = 0.05;
      }
    }
  }
  
  return proximityGrid;
}

/**
 * Compute saddle proximity from detected saddles
 */
export function computeSaddleProximityFromDEM(
  dem: DEMGrid,
  maxDistanceM: number = 250
): TerrainGrid {
  const { saddleGrid, saddlePoints } = detectSaddles(dem);
  const proximityGrid = createEmptyGrid(dem.bbox, dem.resolution_m);
  
  for (let r = 0; r < proximityGrid.rows; r++) {
    for (let c = 0; c < proximityGrid.cols; c++) {
      if (saddlePoints.length === 0) {
        proximityGrid.data[r][c] = saddleGrid.data[r]?.[c] || 0.1;
        continue;
      }
      
      const coord = cellToCoord(r, c, proximityGrid);
      let minDist = Infinity;
      let nearestSaddleScore = 0;
      
      saddlePoints.forEach(sp => {
        const dist = distanceMeters(coord, sp.coord);
        if (dist < minDist) {
          minDist = dist;
          nearestSaddleScore = sp.value;
        }
      });
      
      if (minDist < maxDistanceM) {
        const decay = 1 - (minDist / maxDistanceM);
        // Stronger near-saddle bonus
        proximityGrid.data[r][c] = nearestSaddleScore * decay * decay * 1.2;
      } else {
        proximityGrid.data[r][c] = 0.03;
      }
    }
  }
  
  return proximityGrid;
}

// ========== EXTREME SLOPE PENALTY FROM DEM ==========

/**
 * Compute extreme slope penalty directly from DEM
 */
export function computeExtremeSlopePenaltyFromDEM(dem: DEMGrid): TerrainGrid {
  const { slope } = computeSlopeAspect(dem);
  const penaltyGrid = createEmptyGrid(dem.bbox, dem.resolution_m);
  
  for (let r = 0; r < penaltyGrid.rows; r++) {
    for (let c = 0; c < penaltyGrid.cols; c++) {
      const slopeDeg = slope.data[r]?.[c] || 0;
      
      if (slopeDeg > SLOPE_BANDS.extreme_threshold) {
        penaltyGrid.data[r][c] = 0.9; // Very steep
      } else if (slopeDeg > SLOPE_BANDS.penalty_threshold) {
        const ratio = (slopeDeg - SLOPE_BANDS.penalty_threshold) / 
                     (SLOPE_BANDS.extreme_threshold - SLOPE_BANDS.penalty_threshold);
        penaltyGrid.data[r][c] = 0.3 + 0.6 * ratio;
      } else if (slopeDeg > SLOPE_BANDS.acceptable_max) {
        const ratio = (slopeDeg - SLOPE_BANDS.acceptable_max) / 
                     (SLOPE_BANDS.penalty_threshold - SLOPE_BANDS.acceptable_max);
        penaltyGrid.data[r][c] = 0.1 * ratio;
      } else {
        penaltyGrid.data[r][c] = 0;
      }
    }
  }
  
  return penaltyGrid;
}

// ========== CUT/VALLEY PENALTY FROM DEM ==========

/**
 * Compute cut penalty from drainage detection
 */
export function computeCutPenaltyFromDEM(dem: DEMGrid): TerrainGrid {
  const drainageGrid = detectDrainages(dem);
  const penaltyGrid = createEmptyGrid(dem.bbox, dem.resolution_m);
  
  for (let r = 0; r < penaltyGrid.rows; r++) {
    for (let c = 0; c < penaltyGrid.cols; c++) {
      // Drainages get penalty (deer avoid crossing deep drainages)
      const drainageScore = drainageGrid.data[r]?.[c] || 0;
      penaltyGrid.data[r][c] = drainageScore * 0.6; // Scale down
    }
  }
  
  return penaltyGrid;
}

// ========== FULL DEM COMPONENT ANALYSIS ==========

/**
 * Compute all terrain components from DEM
 * This is the main entry point for DEM-driven analysis
 */
export interface DEMComponentRasters {
  dem: DEMGrid;
  slope_preference: TerrainGrid;
  bench_likelihood: TerrainGrid;
  saddle_proximity: TerrainGrid;
  spine_proximity: TerrainGrid;
  extreme_slope_penalty: TerrainGrid;
  cut_penalty: TerrainGrid;
  // Raw terrain surfaces for debug
  slope_deg: TerrainGrid;
  aspect_deg: TerrainGrid;
  profile_curvature: TerrainGrid;
  plan_curvature: TerrainGrid;
  ridge_likelihood: TerrainGrid;
  saddle_likelihood: TerrainGrid;
  drainage_likelihood: TerrainGrid;
}

export function computeAllDEMComponents(dem: DEMGrid): DEMComponentRasters {
  console.log('[DEM Analysis] Computing all terrain components...');
  
  // Raw terrain analysis
  const { slope: slopeGrid, aspect: aspectGrid } = computeSlopeAspect(dem);
  const curvature = computeCurvature(dem);
  const { ridgeGrid, ridgePoints } = detectRidges(dem);
  const { saddleGrid, saddlePoints } = detectSaddles(dem);
  const drainageGrid = detectDrainages(dem);
  
  console.log('[DEM Analysis] Detected features:', {
    ridgePoints: ridgePoints.length,
    saddlePoints: saddlePoints.length,
  });
  
  // Derived movement surfaces
  const slopePreference = computeTrueSlopePreference(dem);
  const benchLikelihood = detectBenches(dem);
  const spineProximity = computeSpineProximityFromDEM(dem);
  const saddleProximity = computeSaddleProximityFromDEM(dem);
  const extremeSlopePenalty = computeExtremeSlopePenaltyFromDEM(dem);
  const cutPenalty = computeCutPenaltyFromDEM(dem);
  
  return {
    dem,
    slope_preference: slopePreference,
    bench_likelihood: benchLikelihood,
    saddle_proximity: saddleProximity,
    spine_proximity: spineProximity,
    extreme_slope_penalty: extremeSlopePenalty,
    cut_penalty: cutPenalty,
    // Raw surfaces
    slope_deg: slopeGrid,
    aspect_deg: aspectGrid,
    profile_curvature: curvature.profile,
    plan_curvature: curvature.plan,
    ridge_likelihood: ridgeGrid,
    saddle_likelihood: saddleGrid,
    drainage_likelihood: drainageGrid,
  };
}
