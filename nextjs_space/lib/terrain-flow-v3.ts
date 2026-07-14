/**
 * Terrain Flow Analysis Library V3
 * 
 * MAJOR REFACTOR: Removes X-pattern bias
 * 
 * V3 CHANGES:
 * - REMOVED: 4-quadrant diagonal forcing (the X-pattern culprit)
 * - REMOVED: Centroid-based symmetric line generation
 * - ADDED: Pattern archetype classification
 * - ADDED: Edge-based flow seeding
 * - ADDED: Terrain structure detection for flow direction
 * - ADDED: Asymmetric/sparse result support
 * - ADDED: "No structure detected" graceful handling
 * 
 * Pattern Archetypes:
 * 1. LINEAR - Single dominant corridor (ridge or drainage axis)
 * 2. FUNNEL - Converging flows toward one area
 * 3. BENCH - Sidehill contour-following
 * 4. CROSSROADS - True X/Y intersection (rare, terrain-justified)
 * 5. SPARSE - Weak/minimal structure
 * 6. NONE - No detectable flow structure
 */

import type {
  TerrainFlowResponse,
  FlowLineProperties,
  ConvergenceZoneProperties,
  OpportunityZoneProperties,
  FlowTier,
} from '@/types/terrain-flow';
import { sRand } from './seeded-rng';

import {
  TERRAIN_FLOW_WEIGHTS,
  FLOW_THRESHOLDS,
  ANALYSIS_BUFFER_M,
  distanceMeters,
  calculateBearing,
  movePoint,
  getBbox,
  getCentroid,
  expandBbox,
  computeParcelScale,
  type ParcelScaleMetrics,
} from './terrain-analysis';

// Re-export weights
export { TERRAIN_FLOW_WEIGHTS as FLOW_WEIGHTS, FLOW_THRESHOLDS };

// ========== PATTERN ARCHETYPES ==========

export type FlowPatternType = 
  | 'linear'      // Single dominant corridor
  | 'funnel'      // Converging toward one area
  | 'bench'       // Sidehill contour-following
  | 'crossroads'  // True X intersection (rare)
  | 'sparse'      // Weak/minimal structure
  | 'none';       // No detectable structure

export interface PatternClassification {
  type: FlowPatternType;
  confidence: number;         // 0-1
  dominantBearing: number;    // Primary flow direction (degrees)
  secondaryBearing?: number;  // Secondary direction (for crossroads)
  structureScore: number;     // How much terrain structure detected
  explanation: string;
}

// ========== PARCEL EDGE ANALYSIS ==========

interface EdgeSegment {
  start: [number, number];
  end: [number, number];
  midpoint: [number, number];
  bearing: number;
  length: number;
}

/**
 * Analyze parcel edges to find dominant orientations
 * Real terrain often follows property edges due to topographic features
 */
function analyzeParcelEdges(coords: number[][]): EdgeSegment[] {
  const segments: EdgeSegment[] = [];
  
  for (let i = 0; i < coords.length - 1; i++) {
    const start: [number, number] = [coords[i][0], coords[i][1]];
    const end: [number, number] = [coords[i + 1][0], coords[i + 1][1]];
    const length = distanceMeters(start, end);
    
    if (length < 20) continue; // Skip tiny segments
    
    const bearing = calculateBearing(start, end);
    const midpoint: [number, number] = [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2,
    ];
    
    segments.push({ start, end, midpoint, bearing, length });
  }
  
  return segments.sort((a, b) => b.length - a.length);
}

/**
 * Find dominant directions from parcel edges
 * Groups similar bearings and returns weighted averages
 */
function findDominantDirections(edges: EdgeSegment[]): { bearing: number; weight: number }[] {
  if (edges.length === 0) return [];
  
  // Normalize bearings to 0-180 range (ignore direction, just orientation)
  const normalized = edges.map(e => ({
    bearing: e.bearing % 180,
    weight: e.length,
  }));
  
  // Cluster similar bearings (within 20 degrees)
  const clusters: { bearings: number[]; weights: number[] }[] = [];
  
  normalized.forEach(({ bearing, weight }) => {
    const matchCluster = clusters.find(c => {
      const avgBearing = c.bearings.reduce((a, b) => a + b, 0) / c.bearings.length;
      const diff = Math.abs(bearing - avgBearing);
      return diff < 20 || diff > 160; // Account for wrap-around
    });
    
    if (matchCluster) {
      matchCluster.bearings.push(bearing);
      matchCluster.weights.push(weight);
    } else {
      clusters.push({ bearings: [bearing], weights: [weight] });
    }
  });
  
  // Compute weighted average for each cluster
  return clusters.map(c => {
    const totalWeight = c.weights.reduce((a, b) => a + b, 0);
    const weightedSum = c.bearings.reduce((sum, b, i) => sum + b * c.weights[i], 0);
    return {
      bearing: weightedSum / totalWeight,
      weight: totalWeight,
    };
  }).sort((a, b) => b.weight - a.weight);
}

// ========== PATTERN CLASSIFICATION ==========

/**
 * Classify the likely flow pattern based on parcel geometry and terrain indicators
 * This determines what type of flow structure to generate
 */
export function classifyFlowPattern(
  coords: number[][],
  corridorData: any,
  ridgeData: any,
  parcelScale: ParcelScaleMetrics
): PatternClassification {
  const edges = analyzeParcelEdges(coords);
  const dominantDirs = findDominantDirections(edges);
  
  // Check for real corridor data
  const corridors = corridorData?.corridors?.features || corridorData?.features || [];
  const primaryRidgeFeats: any[] = ridgeData?.ridges_primary?.features || [];
  const secondaryRidgeFeats: any[] = ridgeData?.ridges_secondary?.features || [];
  // Moderate/rolling ground frequently expresses ALL its relief as SECONDARY
  // ridges (primary count = 0). Fall back to secondary geometry so pattern
  // classification (funnel/linear) still fires on real relief. Primary is
  // preferred when present to preserve behavior on steeper ground.
  const ridges = primaryRidgeFeats.length > 0 ? primaryRidgeFeats : secondaryRidgeFeats;
  
  const hasCorridors = corridors.length > 0;
  // PROMINENCE-MAGNITUDE GATE (honest flat-terrain gate).
  // Earlier we tried a count-based gate (require >=1 primary ridge or >=1 saddle),
  // but counting could NOT discriminate flat ag from real terrain:
  // the ridge service returns a primary ridge + 10-20 saddles on essentially
  // every parcel, all scored ~0.5. Only prominence MAGNITUDE separates genuine
  // relief from micro-noise. We take the tallest ridge prominence (ft) of
  // EITHER tier (primary OR secondary) and require it to clear a floor before
  // we treat the parcel as having "measured relief." Sub-floor parcels fall
  // through to 'sparse'/'none' and read honestly empty.
  //
  // Why BOTH tiers: moderate/rolling hunting ground routinely has zero primary
  // ridges, with all its relief carried by secondary ridges (e.g. calibration
  // 2026-07: Buffalo 0 primary / 39.6 ft secondary, Callaway 0 / 88.5 ft,
  // Crawford 0 / 68.8 ft). A primary-only gate wrongly read those as flat and
  // erased flow. Calibrated against the LIVE ridge engine on known moderate vs
  // flat-ag parcels (coarse ~26 m DEM, the worst case): flat-ag tops out at
  // ~30 ft on max(primary,secondary); real moderate ground starts at ~33 ft.
  // Floor 32 ft sits in that clean gap. Saddle 'ridgeDropFt' was evaluated as a
  // fallback and REJECTED: it both admits flat-ag false positives (Stoddard
  // delta 39 ft) and misses real ground (Buffalo/Boone have 0 saddles).
  // Floor is env-tunable (FLOW_PROMINENCE_FLOOR_FT) so it can be recalibrated
  // without a code change.
  const maxPrimaryProminenceFt = primaryRidgeFeats.reduce(
    (m: number, f: any) => Math.max(m, Number(f?.properties?.prominenceFt) || 0),
    0
  );
  const maxSecondaryProminenceFt = secondaryRidgeFeats.reduce(
    (m: number, f: any) => Math.max(m, Number(f?.properties?.prominenceFt) || 0),
    0
  );
  const maxProminenceFt = Math.max(maxPrimaryProminenceFt, maxSecondaryProminenceFt);
  const PROMINENCE_FLOOR_FT = Number(process.env.FLOW_PROMINENCE_FLOOR_FT || 32);
  const hasMeasuredRelief = maxProminenceFt >= PROMINENCE_FLOOR_FT;
  const hasRidges = ridges.length > 0 && hasMeasuredRelief;
  
  // Structure score: how much terrain evidence we have
  // NOTE: saddles intentionally excluded — they must not influence routing or pattern classification.
  // Saddles are re-confirmed by proximity AFTER corridor paths are finalized.
  let structureScore = 0;
  if (hasCorridors) structureScore += 0.5;
  if (hasRidges) structureScore += 0.4;
  if (dominantDirs.length > 0) structureScore += 0.1;
  
  // If we have real corridor data, analyze its pattern
  if (hasCorridors && corridors.length >= 2) {
    const corridorBearings = corridors.slice(0, 5).map((c: any) => {
      const coords = c.geometry?.coordinates || [];
      if (coords.length < 2) return null;
      return calculateBearing(
        [coords[0][0], coords[0][1]],
        [coords[coords.length - 1][0], coords[coords.length - 1][1]]
      );
    }).filter((b: number | null): b is number => b !== null);
    
    if (corridorBearings.length >= 2) {
      // Check if corridors have similar directions (linear) or perpendicular (crossroads)
      const spread = computeBearingSpread(corridorBearings);
      
      if (spread < 30) {
        // All corridors go similar direction = LINEAR
        return {
          type: 'linear',
          confidence: 0.85,
          dominantBearing: averageBearing(corridorBearings),
          structureScore,
          explanation: `Corridors align in ${Math.round(averageBearing(corridorBearings))}° direction`,
        };
      } else if (spread > 60 && spread < 120) {
        // Perpendicular corridors = CROSSROADS (but rare)
        return {
          type: 'crossroads',
          confidence: 0.70,
          dominantBearing: corridorBearings[0],
          secondaryBearing: corridorBearings[1],
          structureScore,
          explanation: 'Multiple corridor directions detected, true terrain crossing',
        };
      }
    }
  }
  
  // Ridge-only funnel detection: converging ridges without saddle bias.
  // Saddles intentionally excluded from pattern classification — they must not
  // attract flow routing. Funnel pattern now requires ≥2 converging ridges.
  if (hasRidges && ridges.length >= 2) {
    const ridgeBearings = ridges.slice(0, 4).map((r: any) => {
      const rCoords = r.geometry?.coordinates || [];
      if (rCoords.length < 2) return null;
      return calculateBearing(
        [rCoords[0][0], rCoords[0][1]],
        [rCoords[rCoords.length - 1][0], rCoords[rCoords.length - 1][1]]
      );
    }).filter((b: number | null): b is number => b !== null);
    const ridgeSpread = ridgeBearings.length >= 2 ? computeBearingSpread(ridgeBearings) : 0;
    if (ridgeSpread > 30) {
      return {
        type: 'funnel',
        confidence: 0.65,
        dominantBearing: dominantDirs[0]?.bearing || ridgeBearings[0] || 0,
        structureScore,
        explanation: `Converging ridges (spread ${Math.round(ridgeSpread)}°) suggest funnel/convergence`,
      };
    }
  }
  
  // Check for single ridge = LINEAR
  if (hasRidges && ridges.length === 1) {
    const ridgeCoords = ridges[0].geometry?.coordinates || [];
    if (ridgeCoords.length >= 2) {
      const ridgeBearing = calculateBearing(
        [ridgeCoords[0][0], ridgeCoords[0][1]],
        [ridgeCoords[ridgeCoords.length - 1][0], ridgeCoords[ridgeCoords.length - 1][1]]
      );
      return {
        type: 'linear',
        confidence: 0.80,
        dominantBearing: ridgeBearing,
        structureScore,
        explanation: 'Single ridge spine defines linear flow',
      };
    }
  }
  
  // Fallback: use parcel edge orientation for BENCH pattern.
  // GATED on measured relief: a "bench" is a contour-following sidehill, which
  // only exists where there is real vertical relief. Parcel edge weight fires on
  // ANY sizeable rectangular parcel (edges >200 m), so without this gate flat ag
  // fields would classify as 'bench' and draw contour lines on dead-flat ground.
  // Requiring measured relief lets sub-floor parcels fall through to 'sparse'.
  if (hasMeasuredRelief && dominantDirs.length >= 1 && dominantDirs[0].weight > 200) {
    // Strong dominant edge direction suggests contour-following bench pattern
    return {
      type: 'bench',
      confidence: 0.55,
      dominantBearing: dominantDirs[0].bearing,
      structureScore: Math.max(0.2, structureScore),
      explanation: 'Parcel shape suggests contour-following bench pattern',
    };
  }
  
  // Very weak terrain signal = SPARSE
  if (structureScore < 0.3) {
    return {
      type: 'sparse',
      confidence: 0.40,
      dominantBearing: dominantDirs[0]?.bearing || 45, // Arbitrary fallback
      structureScore,
      explanation: 'Minimal terrain structure detected',
    };
  }
  
  // Default to NONE if nothing detected
  return {
    type: 'none',
    confidence: 0.30,
    dominantBearing: 0,
    structureScore,
    explanation: 'No clear flow structure detected',
  };
}

function computeBearingSpread(bearings: number[]): number {
  if (bearings.length < 2) return 0;
  
  // Normalize to 0-180
  const norm = bearings.map(b => b % 180);
  const min = Math.min(...norm);
  const max = Math.max(...norm);
  
  return max - min;
}

function averageBearing(bearings: number[]): number {
  if (bearings.length === 0) return 0;
  // Simple average (works for similar bearings)
  return bearings.reduce((a, b) => a + b, 0) / bearings.length;
}

// ========== PATTERN-SPECIFIC FLOW GENERATION ==========

/**
 * Generate flows based on classified pattern - NO X-PATTERN FORCING
 */
export function generatePatternBasedFlow(
  coords: number[][],
  pattern: PatternClassification,
  scale: ParcelScaleMetrics
): {
  primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
  secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
} {
  switch (pattern.type) {
    case 'linear':
      return generateLinearFlow(coords, pattern, scale);
    case 'funnel':
      return generateFunnelFlow(coords, pattern, scale);
    case 'bench':
      return generateBenchFlow(coords, pattern, scale);
    case 'crossroads':
      return generateCrossroadsFlow(coords, pattern, scale);
    case 'sparse':
      return generateSparseFlow(coords, pattern, scale);
    case 'none':
    default:
      return { primary: [], secondary: [] }; // No flow is better than fake flow
  }
}

/**
 * LINEAR: Dominant corridor(s) with parallel feeders
 * Classic ridge-line or drainage-axis pattern
 * Scales with parcel size:
 *   <100ac → 1 primary, 0-1 secondary
 *   100-400ac → 1-2 primary, 1-2 secondary
 *   400-1000ac → 2-3 primary, 2-4 secondary
 *   1000+ → 3-4 primary, 3-5 secondary
 */
function generateLinearFlow(
  coords: number[][],
  pattern: PatternClassification,
  scale: ParcelScaleMetrics
): {
  primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
  secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
} {
  const centroid = getCentroid(coords);
  const bearing = pattern.dominantBearing;
  
  const widthM = scale.widthM;
  const heightM = scale.heightM;
  const maxLen = Math.sqrt(widthM * widthM + heightM * heightM) * 0.7;
  
  const primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  const secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  
  // Scale flow counts with acreage
  const numPrimary = Math.max(1, Math.min(scale.isTerritory ? 24 : 4, Math.floor(scale.areaAcres / 400) + 1));
  const numSecondary = scale.areaAcres < 80 ? 0 : Math.max(1, Math.min(scale.isTerritory ? 30 : 5, Math.floor(scale.areaAcres / 300)));
  const perpDir = (bearing + 90) % 360;
  const perpSpacing = Math.min(widthM, heightM) / (numPrimary + 1);
  
  for (let i = 0; i < numPrimary; i++) {
    let offsetM = 0;
    if (i > 0) {
      const side = i % 2 === 1 ? 1 : -1;
      const rank = Math.ceil(i / 2);
      offsetM = side * rank * perpSpacing;
    }
    const startPt = offsetM !== 0 ? movePoint(centroid, perpDir, offsetM) : centroid;
    const len = maxLen * (1 - i * 0.08); // slightly shorter for offset flows
    const varBearing = bearing + (sRand() - 0.5) * (6 + i * 2);
    const line = generateSingleFlowLine(startPt, varBearing, len, scale, 'primary', i);
    if (line) {
      line.properties.likelihood = Math.max(0.55, 0.82 - i * 0.06);
      primary.push(line);
    }
  }
  
  // Secondary feeders spaced across the territory
  for (let s = 0; s < numSecondary; s++) {
    const side = s % 2 === 0 ? 1 : -1;
    const rank = Math.ceil((s + 1) / 2);
    const offset = widthM * 0.12 * rank * side;
    const startPoint = movePoint(centroid, perpDir, offset);
    const variedBearing = bearing + (sRand() - 0.5) * 15;
    const line = generateSingleFlowLine(startPoint, variedBearing, maxLen * (0.45 + sRand() * 0.15), scale, 'secondary', s);
    if (line) {
      line.properties.likelihood = Math.max(0.4, 0.62 - s * 0.04);
      secondary.push(line);
    }
  }
  
  return { primary, secondary };
}

/**
 * FUNNEL: Converging flows toward one or more convergence points
 * Scales with parcel size:
 *   <100ac → 1 convergence point, 1-2 flows
 *   100-500ac → 1-2 convergence points, 2-4 flows
 *   500+ → 2-3 convergence points, 3-6 flows
 */
function generateFunnelFlow(
  coords: number[][],
  pattern: PatternClassification,
  scale: ParcelScaleMetrics
): {
  primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
  secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
} {
  const centroid = getCentroid(coords);
  const bbox = getBbox(coords);
  
  const primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  const secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  
  // Number of convergence funnels scales with acreage
  const numFunnels = Math.max(1, Math.min(scale.isTerritory ? 20 : 3, Math.floor(scale.areaAcres / 500) + 1));
  const flowsPerFunnel = Math.max(2, Math.min(3, Math.floor(scale.areaAcres / 300) + 1));
  const spreadAngle = 35;
  
  for (let f = 0; f < numFunnels; f++) {
    // Space convergence points across the territory
    let convergencePoint: [number, number];
    if (numFunnels === 1) {
      const convergenceOffset = scale.diagonalM * 0.2;
      convergencePoint = movePoint(centroid, pattern.dominantBearing, convergenceOffset);
    } else {
      // Distribute convergence points along the dominant bearing axis
      const t = (f + 0.5) / numFunnels;
      const spanM = scale.diagonalM * 0.6;
      const offset = (t - 0.5) * spanM;
      convergencePoint = movePoint(centroid, pattern.dominantBearing, offset);
    }
    
    for (let i = 0; i < flowsPerFunnel; i++) {
      const angleOffset = (i - (flowsPerFunnel - 1) / 2) * spreadAngle;
      const incomingBearing = (pattern.dominantBearing + 180 + angleOffset + f * 15) % 360;
      
      const startDist = scale.diagonalM * (0.3 + sRand() * 0.15);
      const startPoint = movePoint(convergencePoint, incomingBearing, startDist);
      
      const lineCoords = generateCurvedLineToTarget(startPoint, convergencePoint, scale);
      const length = computeLineLength(lineCoords);
      
      const minLen = i === 0 ? scale.minLengthPrimary : scale.minLengthSecondary;
      if (length < minLen) continue;
      
      const isPrimary = i === 0; // First flow per funnel is primary
      const feature: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties> = {
        type: 'Feature',
        properties: {
          id: `flow_${isPrimary ? 'primary' : 'secondary'}_${f}_${i}`,
          tier: isPrimary ? 'primary' : 'secondary',
          likelihood: isPrimary ? 0.78 - f * 0.04 : 0.6 - f * 0.03,
          lengthM: Math.round(length),
          avgSlope: 8 + sRand() * 5,
          convergenceScore: 0.7 + sRand() * 0.2,
        },
        geometry: { type: 'LineString', coordinates: lineCoords },
      };
      
      if (isPrimary) {
        primary.push(feature);
      } else {
        secondary.push(feature);
      }
    }
  }
  
  return { primary, secondary };
}

/**
 * BENCH: Contour-following flow lines along terrain benches
 * Scales with parcel size:
 *   <100ac → 1 primary, 0-1 secondary
 *   100-400ac → 1-2 primary, 1-2 secondary
 *   400-1000ac → 2-3 primary, 2-4 secondary
 *   1000+ → 3-4 primary, 3-5 secondary
 */
function generateBenchFlow(
  coords: number[][],
  pattern: PatternClassification,
  scale: ParcelScaleMetrics
): {
  primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
  secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
} {
  const centroid = getCentroid(coords);
  const bearing = pattern.dominantBearing;
  const maxLen = scale.diagonalM * 0.55;
  
  const primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  const secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  
  // Scale flow counts with acreage
  const numPrimary = Math.max(1, Math.min(scale.isTerritory ? 24 : 4, Math.floor(scale.areaAcres / 400) + 1));
  const numSecondary = scale.areaAcres < 70 ? 0 : Math.max(1, Math.min(scale.isTerritory ? 30 : 5, Math.floor(scale.areaAcres / 250)));
  const perpDir = (bearing + 90) % 360;
  const perpSpacing = Math.min(scale.widthM, scale.heightM) / (numPrimary + 1);
  
  // Generate primary bench flows spaced perpendicular to contour
  for (let i = 0; i < numPrimary; i++) {
    let offsetM = 0;
    if (i > 0) {
      const side = i % 2 === 1 ? 1 : -1;
      const rank = Math.ceil(i / 2);
      offsetM = side * rank * perpSpacing;
    }
    const startPt = offsetM !== 0 ? movePoint(centroid, perpDir, offsetM) : centroid;
    const len = maxLen * (1 - i * 0.06);
    const varBearing = bearing + (sRand() - 0.5) * (8 + i * 3);
    const line = generateSingleFlowLine(startPt, varBearing, len, scale, 'primary', i);
    if (line) {
      line.properties.likelihood = Math.max(0.52, 0.72 - i * 0.05);
      primary.push(line);
    }
  }
  
  // Secondary feeders: cross-slope connectors between bench levels
  for (let s = 0; s < numSecondary; s++) {
    const side = s % 2 === 0 ? 1 : -1;
    const rank = Math.ceil((s + 1) / 2);
    const offset = scale.widthM * 0.10 * rank * side;
    const offsetPoint = movePoint(centroid, perpDir, offset);
    // Cross-slope feeders run at ~45° to the main bench bearing
    const crossBearing = bearing + 40 * side + (sRand() - 0.5) * 12;
    const line = generateSingleFlowLine(offsetPoint, crossBearing, maxLen * (0.4 + sRand() * 0.15), scale, 'secondary', s);
    if (line) {
      line.properties.likelihood = Math.max(0.38, 0.55 - s * 0.04);
      secondary.push(line);
    }
  }
  
  return { primary, secondary };
}

/**
 * CROSSROADS: True X intersection (rare, terrain-justified)
 * Only used when terrain data shows perpendicular corridors
 */
function generateCrossroadsFlow(
  coords: number[][],
  pattern: PatternClassification,
  scale: ParcelScaleMetrics
): {
  primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
  secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
} {
  const centroid = getCentroid(coords);
  const maxLen = scale.diagonalM * 0.6;
  const perpDir = (pattern.dominantBearing + 90) % 360;
  
  const primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  const secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  
  // Scale crossroads count with acreage
  const numCrossings = Math.max(1, Math.min(scale.isTerritory ? 20 : 3, Math.floor(scale.areaAcres / 500) + 1));
  const perpSpacing = Math.min(scale.widthM, scale.heightM) / (numCrossings + 1);
  
  for (let c = 0; c < numCrossings; c++) {
    let offsetM = 0;
    if (c > 0) {
      const side = c % 2 === 1 ? 1 : -1;
      const rank = Math.ceil(c / 2);
      offsetM = side * rank * perpSpacing;
    }
    const crossCenter = offsetM !== 0 ? movePoint(centroid, perpDir, offsetM) : centroid;
    const len = maxLen * (1 - c * 0.08);
    
    // Primary: dominant direction
    const pLine = generateSingleFlowLine(crossCenter, pattern.dominantBearing + (sRand() - 0.5) * 8, len, scale, 'primary', c);
    if (pLine) primary.push(pLine);
    
    // Secondary: perpendicular direction
    if (pattern.secondaryBearing !== undefined) {
      const sLine = generateSingleFlowLine(crossCenter, pattern.secondaryBearing + (sRand() - 0.5) * 8, len * 0.8, scale, 'secondary', c);
      if (sLine) secondary.push(sLine);
    }
  }
  
  return { primary, secondary };
}

/**
 * SPARSE: Weak/minimal structure
 * At most 1 weak primary flow on large parcels. No secondary.
 * Weak/diffuse parcels may show no meaningful linework — that's intentional.
 */
function generateSparseFlow(
  coords: number[][],
  pattern: PatternClassification,
  scale: ParcelScaleMetrics
): {
  primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
  secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
} {
  const centroid = getCentroid(coords);
  const maxLen = scale.diagonalM * 0.35;
  
  const primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  const secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  
  // Single weak primary flow only on parcels ≥50 acres with some structure
  if (scale.areaAcres >= 50 && pattern.structureScore >= 0.15) {
    const line = generateSingleFlowLine(centroid, pattern.dominantBearing, maxLen, scale, 'primary', 0);
    if (line) {
      line.properties.likelihood = 0.5; // Weak
      primary.push(line);
    }
  }
  
  // No secondary — sparse means sparse
  return { primary, secondary };
}

// ========== LINE GENERATION UTILITIES ==========

function generateSingleFlowLine(
  center: [number, number],
  bearing: number,
  length: number,
  scale: ParcelScaleMetrics,
  tier: FlowTier,
  index: number
): GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties> | null {
  const coords = generateCurvedLine(center, bearing, length, scale.scaleFactor);
  
  if (coords.length < 3) return null;
  
  const actualLength = computeLineLength(coords);
  const minLen = tier === 'primary' ? scale.minLengthPrimary : scale.minLengthSecondary;
  
  if (actualLength < minLen) return null;
  
  return {
    type: 'Feature',
    properties: {
      id: `flow_${tier}_${index}`,
      tier,
      likelihood: tier === 'primary' ? 0.78 + sRand() * 0.12 : 0.58 + sRand() * 0.12,
      lengthM: Math.round(actualLength),
      avgSlope: 7 + sRand() * 6,
      convergenceScore: 0.5 + sRand() * 0.3,
    },
    geometry: { type: 'LineString', coordinates: coords },
  };
}

/**
 * Generate curved line with organic variation
 * Uses compound sinusoidal variation - NO diagonal forcing
 */
function generateCurvedLine(
  start: [number, number],
  bearing: number,
  length: number,
  scaleFactor: number
): [number, number][] {
  const points: [number, number][] = [];
  const numSegments = Math.max(10, Math.round(12 * scaleFactor));
  
  // Random phase offsets for organic variation
  const phase1 = sRand() * Math.PI * 2;
  const phase2 = sRand() * Math.PI * 2;
  
  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments;
    const distAlongLine = (t - 0.5) * length;
    
    // Organic curves with varying amplitudes
    const primaryWave = Math.sin(t * Math.PI * 1.2 + phase1) * length * 0.06;
    const secondaryWave = Math.sin(t * Math.PI * 3.5 + phase2) * length * 0.015;
    const lateralOffset = primaryWave + secondaryWave;
    
    const mainPoint = movePoint(start, bearing, distAlongLine);
    const finalPoint = movePoint(mainPoint, (bearing + 90) % 360, lateralOffset);
    
    points.push(finalPoint);
  }
  
  return points;
}

/**
 * Generate arc-shaped line (for bench patterns)
 */
function generateArcFlowLine(
  center: [number, number],
  bearing: number,
  radius: number,
  scale: ParcelScaleMetrics,
  curvature: number // 0-1, how much arc
): [number, number][] {
  const points: [number, number][] = [];
  const numSegments = 15;
  
  // Arc spans ~90-120 degrees depending on curvature
  const arcSpan = 90 + curvature * 30; // degrees
  const startAngle = bearing - arcSpan / 2;
  
  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments;
    const angle = startAngle + t * arcSpan;
    
    // Varying radius for organic feel
    const r = radius * (0.9 + Math.sin(t * Math.PI) * 0.15);
    
    const point = movePoint(center, angle, r * (0.3 + t * 0.7));
    points.push(point);
  }
  
  return points;
}

/**
 * Generate curved line toward target point (for funnel patterns)
 */
function generateCurvedLineToTarget(
  start: [number, number],
  target: [number, number],
  scale: ParcelScaleMetrics
): [number, number][] {
  const points: [number, number][] = [];
  const numSegments = 12;
  
  const directBearing = calculateBearing(start, target);
  const directDist = distanceMeters(start, target);
  
  // Add some curve to the path
  const curveBias = (sRand() - 0.5) * 30; // degrees
  
  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments;
    
    // Ease-in curve toward target
    const easeT = t * t * (3 - 2 * t); // Smooth step
    
    // Interpolate position with curve
    const currentBearing = directBearing + curveBias * Math.sin(t * Math.PI);
    const currentDist = directDist * easeT;
    
    const point = movePoint(start, currentBearing, currentDist);
    points.push(point);
  }
  
  return points;
}

function computeLineLength(coords: [number, number][]): number {
  let length = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    length += distanceMeters(coords[i], coords[i + 1]);
  }
  return length;
}

// ========== PHASE 1: REAL RIDGE-SPINE TRACER ==========
//
// Deer travel along ridge flanks, so flow lines should TRACE the real ridge
// spine polylines delivered by the ridge service — not be synthesized from the
// parcel centroid + edge-bearing + sinusoid (generateCurvedLine + the six
// generate*Flow archetypes). This tracer replaces the geometry SOURCE:
//   - One flow line per real ridge (strongest prominence first).
//   - Tier rides the ridge service's own prominence-based split: primary ridges
//     -> primary (green) flow, secondary ridges -> secondary (blue) flow.
//   - Honest gate preserved (v5.2 prominence floor): if no ridge clears the
//     floor, we emit ZERO flow. True-or-empty. Never a centroid fallback.
//   - Flow-line count reflects real ridge count, so a 6-ridge parcel honestly
//     shows more linework than a 1-ridge parcel.
//
// Flank offset (deer walk the flank, not the exact crest) is intentionally
// modest and tunable; it defaults to 0 (trace the true spine) because per-vertex
// downslope aspect is a Phase 4 refinement. Set FLOW_RIDGE_FLANK_OFFSET_M > 0 to
// nudge every traced vertex a fixed distance to one side of the crest.

// Flag: ridge tracing is the geometry source (default ON). Set FLOW_RIDGE_TRACE=0
// to revert to the retired centroid/sinusoid template (generatePatternBasedFlow),
// which is left in place purely as an escape hatch and no longer renders by default.
const RIDGE_TRACE_ENABLED = (process.env.FLOW_RIDGE_TRACE ?? '1') !== '0';
// Phase 4 tuning knob; 0 = trace the true crest.
const RIDGE_FLANK_OFFSET_M = Number(process.env.FLOW_RIDGE_FLANK_OFFSET_M || 0);
// Generous per-tier caps so density reflects real terrain complexity without
// becoming absurd on dense multi-ridge parcels. Strongest ridges are kept first.
const RIDGE_TRACE_MAX_PER_TIER = 30;
// Ridges are relevant if they fall within the parcel bbox expanded by this margin
// (roughly the buffered analysis window / visible map extent).
const RIDGE_RELEVANCE_MARGIN_M = 300;

interface RidgeFeatureLite {
  coords: [number, number][];
  prominenceFt: number;
  ridgeScore: number;
  lengthMeters: number;
}

function extractRidgeFeatures(fc: any): RidgeFeatureLite[] {
  const feats: any[] = fc?.features || [];
  const out: RidgeFeatureLite[] = [];
  for (const f of feats) {
    const g = f?.geometry;
    if (!g || g.type !== 'LineString') continue;
    const raw: any[] = g.coordinates || [];
    const coords: [number, number][] = raw
      .filter((c) => Array.isArray(c) && c.length >= 2 && isFinite(c[0]) && isFinite(c[1]))
      .map((c) => [c[0], c[1]] as [number, number]);
    if (coords.length < 2) continue;
    const p = f.properties || {};
    out.push({
      coords,
      prominenceFt: Number(p.prominenceFt) || 0,
      ridgeScore: Number(p.avgRidgeScore) || 0,
      lengthMeters: Number(p.lengthMeters) || computeLineLength(coords),
    });
  }
  return out;
}

/** Offset a ridge polyline a fixed distance to one side of the crest (flank). */
function offsetRidgeToFlank(coords: [number, number][], offsetM: number): [number, number][] {
  if (offsetM === 0 || coords.length < 2) return coords;
  const out: [number, number][] = [];
  for (let i = 0; i < coords.length; i++) {
    const prev = coords[Math.max(0, i - 1)];
    const next = coords[Math.min(coords.length - 1, i + 1)];
    const localBearing = calculateBearing(prev, next);
    // Offset perpendicular to local travel direction (consistent side).
    out.push(movePoint(coords[i], (localBearing + 90) % 360, offsetM));
  }
  return out;
}

/** True if any vertex of the polyline falls inside a bbox. */
function polylineInBbox(coords: [number, number][], bbox: [number, number, number, number]): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return coords.some((c) => c[0] >= minLng && c[0] <= maxLng && c[1] >= minLat && c[1] <= maxLat);
}

/**
 * Trace flow lines directly from real ridge-spine geometry.
 * Returns empty (honest gate) when no ridge clears the v5.2 prominence floor.
 */
function traceFlowFromRidges(
  ridgeData: any,
  parcelRings: number[][][],
  scale: ParcelScaleMetrics
): {
  primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
  secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
} {
  const primaryRidgesAll = extractRidgeFeatures(ridgeData?.ridges_primary);
  const secondaryRidgesAll = extractRidgeFeatures(ridgeData?.ridges_secondary);

  if (primaryRidgesAll.length === 0 && secondaryRidgesAll.length === 0) {
    console.log('[RidgeTrace] No ridge geometry — empty flow (honest gate).');
    return { primary: [], secondary: [] };
  }

  // The ridge service returns spines for a large buffered window (up to ~1 km
  // around the parcel). Only ridges near the parcel are relevant to on-parcel
  // deer flow, so scope to the parcel bbox expanded by a margin BEFORE both the
  // honest gate and tracing. This keeps the gate reason and the rendered output
  // consistent: gate-pass ⟺ at least one traceable ridge near the parcel.
  const parcelBbox = getBbox(parcelRings.flat());
  const relevanceBbox = expandBbox(parcelBbox, RIDGE_RELEVANCE_MARGIN_M);
  const primaryRidges = primaryRidgesAll.filter((r) => polylineInBbox(r.coords, relevanceBbox));
  const secondaryRidges = secondaryRidgesAll.filter((r) => polylineInBbox(r.coords, relevanceBbox));

  if (primaryRidges.length === 0 && secondaryRidges.length === 0) {
    console.log('[RidgeTrace] No ridge within %d m of parcel — empty flow (honest gate).', RIDGE_RELEVANCE_MARGIN_M);
    return { primary: [], secondary: [] };
  }

  // Honest gate (v5.2): require measured relief above the prominence floor on
  // EITHER tier, evaluated over the parcel-relevant ridges. Sub-floor parcels
  // (flat ag / gate fails) read empty — never a centroid template fallback.
  const PROMINENCE_FLOOR_FT = Number(process.env.FLOW_PROMINENCE_FLOOR_FT || 32);
  const maxProminenceFt = [...primaryRidges, ...secondaryRidges].reduce(
    (m, r) => Math.max(m, r.prominenceFt),
    0
  );
  if (maxProminenceFt < PROMINENCE_FLOOR_FT) {
    console.log(
      '[RidgeTrace] Max relevant ridge prominence %d ft < floor %d ft — empty flow (honest gate).',
      Math.round(maxProminenceFt),
      PROMINENCE_FLOOR_FT
    );
    return { primary: [], secondary: [] };
  }

  const buildTier = (
    ridges: RidgeFeatureLite[],
    tier: FlowTier
  ): GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] => {
    // Strongest prominence first, capped per tier.
    const relevant = ridges
      .slice()
      .sort((a, b) => b.prominenceFt - a.prominenceFt)
      .slice(0, RIDGE_TRACE_MAX_PER_TIER);

    const feats: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
    relevant.forEach((r, idx) => {
      const coords = offsetRidgeToFlank(r.coords, RIDGE_FLANK_OFFSET_M);
      const lengthM = Math.round(computeLineLength(coords));
      // Likelihood rides the ridge's real measured prominence/score — not a template.
      const promNorm = Math.min(1, r.prominenceFt / 150); // ~150 ft = strong spine
      const base = tier === 'primary' ? 0.6 : 0.45;
      const likelihood = Math.max(
        tier === 'primary' ? 0.55 : 0.4,
        Math.min(0.95, base + promNorm * 0.3 + r.ridgeScore * 0.1)
      );
      // Rough slope from prominence over run (display metadata only).
      const promM = r.prominenceFt * 0.3048;
      const avgSlope = r.lengthMeters > 0
        ? Math.max(2, Math.min(35, (Math.atan(promM / r.lengthMeters) * 180) / Math.PI * 4))
        : 7;
      feats.push({
        type: 'Feature',
        properties: {
          id: `flow_${tier}_${idx}`,
          tier,
          likelihood,
          lengthM,
          avgSlope,
          convergenceScore: 0.5,
        },
        geometry: { type: 'LineString', coordinates: coords },
      });
    });
    return feats;
  };

  const primary = buildTier(primaryRidges, 'primary');
  const secondary = buildTier(secondaryRidges, 'secondary');

  console.log(
    '[RidgeTrace] Traced %d primary + %d secondary flow lines from real ridges (maxProm=%d ft).',
    primary.length,
    secondary.length,
    Math.round(maxProminenceFt)
  );

  return { primary, secondary };
}

// ========== PHASE 2: SADDLE CROSSINGS ==========
// Phase 1 traces each ridge as its own flow line. A saddle is the low col where
// the ridge crest dips — the real gap deer use to cross from one drainage to the
// next. Phase 2 lifts the old "saddles must not influence routing" ban and makes
// real saddle nodes a first-class routing input: for each quality saddle sitting
// on a traced ridge, we add a short crossing corridor perpendicular to the ridge
// axis, passing through the real saddle point, so the network reads
// ridge-travel → cross at the saddle → ridge-travel. Honest or nothing: only real
// saddles from the service, and only where they sit on a traced ridge.
const SADDLE_CROSSINGS_ENABLED = (process.env.FLOW_SADDLE_CROSSINGS ?? '1') !== '0';
// A saddle must sit within this distance of a traced ridge flow line to count as
// a real crossing on that ridge (else it would be a floating stub).
const SADDLE_MAX_RIDGE_DIST_M = Number(process.env.FLOW_SADDLE_MAX_RIDGE_DIST_M || 130);
// Half-length of each crossing arm (per flank side). Clamped to parcel scale.
const SADDLE_CROSSING_REACH_M = Number(process.env.FLOW_SADDLE_CROSSING_REACH_M || 90);
// Deep saddles (bigger ridgeDropFt) read as stronger crossings; normalization ceiling.
const SADDLE_DROP_NORM_FT = 80;
// A saddle at/above this drop is treated as a strong (primary-tier) crossing.
const SADDLE_STRONG_DROP_FT = 40;
const SADDLE_MAX_CROSSINGS = 40;

interface SaddleNodeLite {
  coord: [number, number];
  ridgeDropFt: number;
}

function extractSaddleNodes(fc: any): SaddleNodeLite[] {
  const feats: any[] = fc?.features || [];
  const out: SaddleNodeLite[] = [];
  for (const f of feats) {
    const g = f?.geometry;
    if (!g || g.type !== 'Point') continue;
    const c = g.coordinates;
    if (!Array.isArray(c) || c.length < 2 || !isFinite(c[0]) || !isFinite(c[1])) continue;
    const p = f.properties || {};
    out.push({ coord: [c[0], c[1]], ridgeDropFt: Number(p.ridgeDropFt) || 0 });
  }
  return out;
}

/**
 * Nearest traced ridge flow line to a point. Returns the min distance (m) and
 * the local ridge bearing there (from the vertices bracketing the nearest one),
 * so the crossing can be drawn perpendicular to the real ridge axis.
 */
function nearestRidgeBearing(
  point: [number, number],
  flows: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[]
): { distM: number; bearing: number } | null {
  let best: { distM: number; bearing: number } | null = null;
  for (const f of flows) {
    const cs = f.geometry.coordinates as [number, number][];
    for (let i = 0; i < cs.length; i++) {
      const d = distanceMeters(point, cs[i]);
      if (best === null || d < best.distM) {
        const prev = cs[Math.max(0, i - 1)];
        const next = cs[Math.min(cs.length - 1, i + 1)];
        best = { distM: d, bearing: calculateBearing(prev, next) };
      }
    }
  }
  return best;
}

/**
 * Build saddle-crossing flow lines that connect the Phase-1 ridge flows through
 * real saddle gaps. Honest gate: no ridge flow → nothing to cross; no saddle on
 * a traced ridge → zero crossings (ridge lines only). Never fabricates a gap.
 */
function traceSaddleCrossings(
  ridgeData: any,
  ridgeFlows: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[],
  parcelRings: number[][][],
  scale: ParcelScaleMetrics
): {
  primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
  secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
} {
  const primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  const secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];

  // Phase 2 builds ON Phase 1 — no ridge flow means there is nothing to cross.
  if (ridgeFlows.length === 0) return { primary, secondary };

  const saddlesAll = extractSaddleNodes(ridgeData?.saddle_nodes);
  if (saddlesAll.length === 0) {
    console.log('[SaddleCross] No saddle nodes — ridge lines only (honest).');
    return { primary, secondary };
  }

  const parcelBbox = getBbox(parcelRings.flat());
  // Cheap pre-filter window. Traced ridges already live within parcel+300m; a
  // valid saddle only needs to be within SADDLE_MAX_RIDGE_DIST_M of one of them,
  // so widen the pre-filter by that reach to avoid clipping edge saddles. The
  // real relevance gate is the distance-to-traced-ridge test below.
  const relevanceBbox = expandBbox(parcelBbox, RIDGE_RELEVANCE_MARGIN_M + SADDLE_MAX_RIDGE_DIST_M);
  const [minLng, minLat, maxLng, maxLat] = relevanceBbox;
  const inBbox = (c: [number, number]) =>
    c[0] >= minLng && c[0] <= maxLng && c[1] >= minLat && c[1] <= maxLat;

  // Crossing arm length, kept proportional to the parcel (clamped).
  const reachM = Math.max(
    45,
    Math.min(SADDLE_CROSSING_REACH_M, Math.round(scale.convergenceSearchRadius || SADDLE_CROSSING_REACH_M))
  );

  // Strongest (deepest) saddles first, scoped to the parcel-relevant window.
  const relevant = saddlesAll
    .filter((s) => inBbox(s.coord))
    .sort((a, b) => b.ridgeDropFt - a.ridgeDropFt)
    .slice(0, SADDLE_MAX_CROSSINGS);

  let idx = 0;
  let skippedFar = 0;
  for (const s of relevant) {
    const nr = nearestRidgeBearing(s.coord, ridgeFlows);
    if (!nr || nr.distM > SADDLE_MAX_RIDGE_DIST_M) {
      skippedFar++;
      continue;
    }
    const perp = (nr.bearing + 90) % 360;
    const endA = movePoint(s.coord, perp, reachM);
    const endB = movePoint(s.coord, (perp + 180) % 360, reachM);
    // The crossing passes THROUGH the real saddle point, perpendicular to the
    // ridge axis — so it meets the ridge flow at the saddle and reaches into the
    // flank on each side (ridge → cross → ridge), not a floating stub.
    const coords: [number, number][] = [endA, s.coord, endB];
    const lengthM = Math.round(computeLineLength(coords));
    const dropNorm = Math.min(1, s.ridgeDropFt / SADDLE_DROP_NORM_FT);
    const likelihood = Math.max(0.4, Math.min(0.9, 0.45 + dropNorm * 0.4));
    const tier: FlowTier = s.ridgeDropFt >= SADDLE_STRONG_DROP_FT ? 'primary' : 'secondary';
    const feat: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties> = {
      type: 'Feature',
      properties: {
        id: `flow_saddle_${idx}`,
        tier,
        likelihood,
        lengthM,
        avgSlope: 6,
        convergenceScore: 0.5,
      },
      geometry: { type: 'LineString', coordinates: coords },
    };
    (tier === 'primary' ? primary : secondary).push(feat);
    idx++;
  }

  console.log(
    '[SaddleCross] Built %d saddle crossings (%d saddles total, %d in-window, %d skipped far from ridge).',
    idx,
    saddlesAll.length,
    relevant.length,
    skippedFar
  );
  return { primary, secondary };
}

// ========== MAIN ENTRY POINT ==========

/**
 * Generate terrain flow using V3 pattern-based approach
 * NO X-PATTERN BIAS
 */
export function generateTerrainFlowV3(
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  corridorData: any,
  ridgeData: any,
  beddingPolygons?: GeoJSON.FeatureCollection,
  funnels?: GeoJSON.FeatureCollection
): TerrainFlowResponse {
  const startTime = Date.now();
  
  // Extract parcel coordinates — union ALL sub-polygons for territory mode
  const { allCoords: coords, rings: parcelRings } = extractMultiPolygonData(parcel);
  
  if (coords.length < 4) {
    return emptyFlowResponse('Insufficient parcel coordinates');
  }
  
  const bbox = getBbox(coords);
  const centroid = getCentroid(coords);
  const widthM = distanceMeters([bbox[0], centroid[1]], [bbox[2], centroid[1]]);
  const heightM = distanceMeters([centroid[0], bbox[1]], [centroid[0], bbox[3]]);
  
  // Compute parcel scale
  const isTerritory = parcelRings.length > 1;
  const parcelScale = computeParcelScale(widthM, heightM, isTerritory);
  
  console.log('[TerrainFlowV3] Parcel: %d x %d m (~%d acres), rings=%d', 
    Math.round(widthM), Math.round(heightM), Math.round(parcelScale.areaAcres), parcelRings.length);
  
  // Classify flow pattern
  const pattern = classifyFlowPattern(coords, corridorData, ridgeData, parcelScale);
  
  console.log('[TerrainFlowV3] Pattern: %s (confidence=%.2f, structure=%.2f)', 
    pattern.type, pattern.confidence, pattern.structureScore);
  console.log('[TerrainFlowV3] %s', pattern.explanation);
  
  // Phase 1 geometry source: TRACE real ridge spines (deer walk the ridge flanks)
  // instead of synthesizing lines from the parcel centroid + edge-bearing +
  // sinusoid. The centroid/sinusoid template (generatePatternBasedFlow) is
  // retired as the geometry source and kept only behind FLOW_RIDGE_TRACE=0 as a
  // revert escape hatch — it no longer renders by default.
  let primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
  let secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[];
  if (RIDGE_TRACE_ENABLED) {
    ({ primary, secondary } = traceFlowFromRidges(ridgeData, parcelRings, parcelScale));
    // Phase 2: route flow through real saddle gaps. Only when ridge spines were
    // actually traced (crossings connect traced ridges — never float on their own).
    if (SADDLE_CROSSINGS_ENABLED && (primary.length + secondary.length) > 0) {
      const cross = traceSaddleCrossings(ridgeData, [...primary, ...secondary], parcelRings, parcelScale);
      primary.push(...cross.primary);
      secondary.push(...cross.secondary);
    }
  } else {
    // Retired legacy template (escape hatch only).
    ({ primary, secondary } = generatePatternBasedFlow(coords, pattern, parcelScale));
  }
  
  // Generate convergence zones (if flows exist) — pass all rings for multi-parcel containment
  const convergenceZones = generateConvergenceFromFlows(primary, secondary, parcelRings, parcelScale);
  
  // Generate opportunity zones scored by 4-component terrain formula
  const opportunityZones = generateOpportunityZones(convergenceZones, parcelScale, ridgeData, beddingPolygons, funnels);
  
  const processingTime = (Date.now() - startTime) / 1000;
  const totalLength = [...primary, ...secondary].reduce((sum, f) => sum + (f.properties.lengthM || 0), 0);
  
  console.log('[TerrainFlowV3] Generated: %d primary, %d secondary, %d convergence, %d opportunity',
    primary.length, secondary.length, convergenceZones.length, opportunityZones.length);
  
  return {
    success: true,
    bbox,
    flow_primary: { type: 'FeatureCollection', features: primary },
    flow_secondary: { type: 'FeatureCollection', features: secondary },
    convergence_zones: { type: 'FeatureCollection', features: convergenceZones },
    opportunity_zones: { type: 'FeatureCollection', features: opportunityZones },
    metadata: {
      processing_time_seconds: processingTime,
      mode: 'terrain_driven',
      dem_source: corridorData ? 'CORRIDOR_STRUCTURE' : 'PATTERN_INFERRED',
      resolution_m: 30,
      buffer_m: ANALYSIS_BUFFER_M,
      weights: TERRAIN_FLOW_WEIGHTS,
      thresholds: {
        primary_min: FLOW_THRESHOLDS.primary_percentile,
        secondary_min: FLOW_THRESHOLDS.secondary_percentile,
        min_length_m_primary: parcelScale.minLengthPrimary,
        min_length_m_secondary: parcelScale.minLengthSecondary,
        convergence_threshold: FLOW_THRESHOLDS.convergence_threshold,
        opportunity_threshold: FLOW_THRESHOLDS.opportunity_threshold,
      },
      stats: {
        flow_count_primary: primary.length,
        flow_count_secondary: secondary.length,
        convergence_count: convergenceZones.length,
        opportunity_count: opportunityZones.length,
        total_flow_length_m: totalLength,
        coverage_pct: 0,
      },
      fallback_reason: pattern.structureScore < 0.3 ? pattern.explanation : null,
      analysis_extent: {
        parcel_bbox: bbox,
        buffered_bbox: bbox,
      },
      pattern: {
        type: pattern.type,
        confidence: pattern.confidence,
        structure_score: pattern.structureScore,
        dominant_bearing: pattern.dominantBearing,
        explanation: pattern.explanation,
      },
    },
  };
}

// ========== CONVERGENCE AND OPPORTUNITY ==========

function generateConvergenceFromFlows(
  primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[],
  secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[],
  parcelRings: number[][][],
  scale: ParcelScaleMetrics
): GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[] {
  const allFlows = [...primary, ...secondary];
  if (allFlows.length < 1) return [];
  
  const zones: GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[] = [];
  const proximityM = scale.convergenceSearchRadius;
  const foundPoints: { coord: [number, number]; intensity: number; flowCount: number }[] = [];
  
  // Find intersection/proximity points between flows
  for (let i = 0; i < allFlows.length; i++) {
    for (let j = i + 1; j < allFlows.length; j++) {
      const coords1 = allFlows[i].geometry.coordinates;
      const coords2 = allFlows[j].geometry.coordinates;
      
      for (const p1 of coords1) {
        for (const p2 of coords2) {
          const dist = distanceMeters([p1[0], p1[1]], [p2[0], p2[1]]);
          if (dist < proximityM) {
            const midpoint: [number, number] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
            
            // Check if inside any parcel ring (territory multi-parcel support)
            if (!pointInAnyRing(midpoint, parcelRings)) continue;
            
            // Merge with nearby found point or add new
            const existing = foundPoints.find(fp => 
              distanceMeters(fp.coord, midpoint) < proximityM * 0.5
            );
            
            if (existing) {
              existing.intensity = Math.min(1, existing.intensity + 0.15);
              existing.flowCount++;
            } else {
              foundPoints.push({
                coord: midpoint,
                intensity: 0.7 + (1 - dist / proximityM) * 0.2,
                flowCount: 2,
              });
            }
          }
        }
      }
    }
  }
  
  // v5: Honest convergence — no synthetic centered fallback.
  // Previously, when flow lines never intersected (typical on flat/poor ground
  // where lines run weak and roughly parallel), we planted ONE convergence zone
  // at the midpoint of the primary flow line. Because primary flow lines are
  // centroid-seeded, that midpoint sat near the scope center, producing the same
  // centered "convergence ribbon" on every poor parcel regardless of terrain.
  // Real convergence must come from actual flow-line intersections only. If none
  // exist, we emit ZERO convergence zones — poor ground now honestly reads empty.
  
  // Sort and limit
  foundPoints.sort((a, b) => b.intensity - a.intensity);
  
  foundPoints.slice(0, scale.maxConvergenceZones).forEach((fp, idx) => {
    zones.push({
      type: 'Feature',
      properties: {
        id: `conv_${idx}`,
        intensity: fp.intensity,
        flowCount: Math.min(4, fp.flowCount),
        // v4.3: On large territories, clamp the flow-count contribution so a
        // high-flow node stays a local pinch instead of a km-scale blob.
        // Single parcels & small territories keep the original raw formula.
        radiusM: scale.convergenceBaseRadius +
          (scale.isTerritory && scale.areaAcres >= 3000 ? Math.min(4, fp.flowCount) : fp.flowCount) * 10,
        type: fp.flowCount >= 3 ? 'pinch' : 'overlap',
      },
      geometry: { type: 'Point', coordinates: fp.coord },
    });
  });
  
  return zones;
}

/**
 * Generate opportunity zones (stand sites) scored by terrain formula:
 *   stand_score = 0.50×bench_prox + 0.40×ridge_struct + convergence_tie_breaker
 *
 * NOTE: saddle_prox intentionally removed from scoring — saddles must NOT attract
 * routing or stand placement. Saddles are tagged post-routing by proximity only.
 *
 * Candidate points: convergence zone centers, ridge-bench intersections, flow intersections.
 * Hard cap: 1-3 sites, min 80m separation.
 */
function generateOpportunityZones(
  convergenceZones: GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[],
  scale: ParcelScaleMetrics,
  ridgeData?: { ridges_primary?: GeoJSON.FeatureCollection; ridges_secondary?: GeoJSON.FeatureCollection; saddle_nodes?: GeoJSON.FeatureCollection; isSynthetic?: boolean },
  beddingPolygons?: GeoJSON.FeatureCollection,
  funnels?: GeoJSON.FeatureCollection
): GeoJSON.Feature<GeoJSON.Point, OpportunityZoneProperties>[] {
  const MIN_SEPARATION_M = 80;
  const MAX_ZONES = scale.isTerritory ? scale.maxOpportunityZones : Math.min(3, scale.maxOpportunityZones);

  // v2.9 – Terrain-first candidate scoring.  Convergence is a tiny tie-breaker, NOT a primary signal.
  // v3.10 – saddle_prox removed from scoring; saddles no longer attract stand placement.
  const candidates: { coord: [number, number]; benchProx: number; saddleProx: number; ridgeStruct: number; convergenceTB: number }[] = [];

  // Helper: score proximity to nearest feature in a collection
  const proximityScore = (coord: [number, number], fc: GeoJSON.FeatureCollection | undefined, radiusM: number): number => {
    if (!fc?.features?.length) return 0;
    let minDist = Infinity;
    for (const f of fc.features) {
      if (f.geometry.type === 'Point') {
        const d = distanceMeters(coord, f.geometry.coordinates as [number, number]);
        if (d < minDist) minDist = d;
      } else if (f.geometry.type === 'Polygon') {
        const centroid = getPolygonCentroid(f.geometry);
        if (centroid) {
          const d = distanceMeters(coord, centroid);
          if (d < minDist) minDist = d;
        }
      } else if (f.geometry.type === 'LineString') {
        const coords = (f.geometry as GeoJSON.LineString).coordinates;
        for (const c of coords) {
          const d = distanceMeters(coord, [c[0], c[1]]);
          if (d < minDist) minDist = d;
        }
      }
    }
    return minDist < radiusM ? Math.max(0, 1 - minDist / radiusM) : 0;
  };

  const ridgePrimary = ridgeData?.ridges_primary;
  const ridgeSecondary = ridgeData?.ridges_secondary;
  const saddleNodes = ridgeData?.saddle_nodes;
  const isSynthetic = ridgeData?.isSynthetic ?? true;
  const ridgePenalty = isSynthetic ? 0.5 : 1.0;

  // All ridges combined for proximity check
  const allRidgesFC: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [...(ridgePrimary?.features || []), ...(ridgeSecondary?.features || [])],
  };

  // Score a single candidate point – terrain components only, convergence as tie-breaker
  const scorePt = (coord: [number, number]) => {
    const benchProx = proximityScore(coord, beddingPolygons, 140);
    const saddleProx = proximityScore(coord, saddleNodes, 200);
    const ridgeStruct = proximityScore(coord, allRidgesFC, 140) * ridgePenalty;
    // Convergence: tiny proximity check for tie-breaking only (capped contribution)
    const convergenceTB = proximityScore(coord, funnels, 120) * 0.10; // max 10% influence
    return { coord, benchProx, saddleProx, ridgeStruct, convergenceTB };
  };

  // Source 1: convergence zone centers (terrain-derived pinch points)
  if (convergenceZones.length > 0) {
    for (const cz of convergenceZones) {
      if (cz.geometry.type === 'Point') {
        const coord = cz.geometry.coordinates as [number, number];
        candidates.push(scorePt(coord));
      }
    }
  }
  // NOTE: saddle nodes intentionally NOT used as candidate sources.
  // Saddles must not attract stand placement — they are tagged post-routing.

  // Source 3: ridge-bench intersections (where ridge meets bedding)
  if (allRidgesFC.features.length > 0 && beddingPolygons?.features?.length) {
    for (const ridge of allRidgesFC.features) {
      const rCoords = (ridge.geometry as GeoJSON.LineString)?.coordinates || [];
      for (const bed of beddingPolygons.features) {
        const bedCentroid = getPolygonCentroid(bed.geometry);
        if (!bedCentroid) continue;
        // Find closest ridge point to bench centroid
        let closestDist = Infinity;
        let closestPt: [number, number] | null = null;
        for (const rc of rCoords) {
          const d = distanceMeters([rc[0], rc[1]], bedCentroid);
          if (d < closestDist) {
            closestDist = d;
            closestPt = [rc[0], rc[1]];
          }
        }
        if (closestPt && closestDist < 250) {
          const midPt: [number, number] = [(closestPt[0] + bedCentroid[0]) / 2, (closestPt[1] + bedCentroid[1]) / 2];
          candidates.push(scorePt(midPt));
        }
      }
    }
  }

  // Score each candidate: 2-component terrain formula + convergence tie-breaker
  // v3.10: saddle_prox zeroed out — saddles no longer attract stand placement
  const scored = candidates.map(c => ({
    ...c,
    totalScore: 0.50 * c.benchProx + 0.00 * c.saddleProx + 0.40 * c.ridgeStruct + c.convergenceTB,
  }));

  // Sort by total score descending
  scored.sort((a, b) => b.totalScore - a.totalScore);

  // Spatial deduplication: keep only zones that are MIN_SEPARATION_M apart
  const selected: typeof scored = [];
  for (const candidate of scored) {
    if (selected.length >= MAX_ZONES) break;
    if (candidate.totalScore < 0.10) continue; // Minimum threshold
    const tooClose = selected.some(s =>
      distanceMeters(candidate.coord, s.coord) < MIN_SEPARATION_M
    );
    if (!tooClose) {
      selected.push(candidate);
    }
  }

  return selected.map((s, i) => ({
    type: 'Feature' as const,
    properties: {
      id: `opp_${i}`,
      score: Math.min(1, s.totalScore * 1.5 + 0.1), // Normalize to 0-1 display range
      flowIntensity: s.convergenceTB,            // kept for layer compat; now tiny
      convergenceBonus: s.convergenceTB,
      benchBonus: s.benchProx * 0.40,
      saddleBonus: 0, // v3.10: saddle no longer contributes to stand scoring
      radiusM: scale.opportunityRadius,
    },
    geometry: { type: 'Point' as const, coordinates: s.coord },
  }));
}

// Helper for opportunity zone scoring
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
  for (const c of coords) { sumX += c[0]; sumY += c[1]; }
  return [sumX / coords.length, sumY / coords.length];
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

/** Check if a point is inside ANY polygon ring (territory multi-parcel support). */
function pointInAnyRing(point: [number, number], rings: number[][][]): boolean {
  return rings.some(ring => pointInPolygon(point, ring));
}

/**
 * Extract ALL coordinate rings from a Polygon or MultiPolygon feature.
 * Returns { allCoords: flat array of all vertices for bbox/centroid,
 *           rings: individual polygon rings for point-in-polygon tests }
 */
function extractMultiPolygonData(
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
): { allCoords: number[][]; rings: number[][][] } {
  if (parcel.geometry.type === 'Polygon') {
    return { allCoords: parcel.geometry.coordinates[0], rings: [parcel.geometry.coordinates[0]] };
  }
  const rings: number[][][] = [];
  const allCoords: number[][] = [];
  for (const poly of parcel.geometry.coordinates) {
    const outerRing = poly[0];
    rings.push(outerRing);
    allCoords.push(...outerRing);
  }
  return { allCoords, rings };
}

function emptyFlowResponse(reason: string): TerrainFlowResponse {
  return {
    success: true,
    bbox: [0, 0, 0, 0],
    flow_primary: { type: 'FeatureCollection', features: [] },
    flow_secondary: { type: 'FeatureCollection', features: [] },
    convergence_zones: { type: 'FeatureCollection', features: [] },
    opportunity_zones: { type: 'FeatureCollection', features: [] },
    metadata: {
      processing_time_seconds: 0,
      mode: 'synthetic',
      dem_source: 'NONE',
      resolution_m: 0,
      buffer_m: 0,
      weights: TERRAIN_FLOW_WEIGHTS,
      thresholds: {
        primary_min: 0,
        secondary_min: 0,
        min_length_m_primary: 0,
        min_length_m_secondary: 0,
        convergence_threshold: 0,
        opportunity_threshold: 0,
      },
      stats: {
        flow_count_primary: 0,
        flow_count_secondary: 0,
        convergence_count: 0,
        opportunity_count: 0,
        total_flow_length_m: 0,
        coverage_pct: 0,
      },
      fallback_reason: reason,
    },
  };
}
