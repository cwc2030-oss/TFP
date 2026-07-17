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
import { assessBackbone, NETWORK_LINE_MIN_FT, type BackboneVerdict } from './terrain-backbone';
import { MAX_ANALYSIS_ACRES, acresToRadiusMeters } from './flow-flags';

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

// ── Neighborhood verdict window (v6.5): the parcel-scoped +300m relevance window
// under-read small/mid parcels. A tiny lot in genuinely rolling hills kept ZERO
// of the real ridge lines the DEM found (the +300m box fell inside the valley
// below the surrounding spines), so the verdict read FLAT while the A-300
// hunt-zone scope at the exact same spot read CONFIRMED. Worse, the single-vertex
// bbox test made mid-size parcels non-monotonic (40ac flat, 10ac & 200ac
// confirmed at one hilly center) — pure alignment luck. Deer move by neighborhood
// terrain, not parcel lines, and the whole product is the 300-ac scope, so the
// USER-FACING verdict must be judged on the SAME neighborhood window the flow and
// map already compute on. We floor the relevance window to the A-300 hunt-zone
// radius centered on the parcel centroid: small/mid parcels now see the
// neighborhood ridges; large parcels (>300ac) keep their own bigger window via
// the union; and the hunt-zone circle path is byte-for-byte unchanged (its own
// bbox already equals the neighborhood floor, so the union is a no-op there).
// Flat-ag guards stay flat because a genuinely flat neighborhood has no
// prominence-qualified ridge inside this window either — exactly why the flow
// path already keeps those guards empty.
const NEIGHBORHOOD_VERDICT_RADIUS_M = acresToRadiusMeters(MAX_ANALYSIS_ACRES); // ~621.7m (A-300)

/**
 * Relevance window for the honest verdict + tracing. Floors the parcel bbox to a
 * minimum A-300 hunt-zone window centered on the parcel centroid, unions with the
 * parcel's own (possibly larger) bbox, then applies the standard relevance margin
 * (plus any caller-supplied extra reach, e.g. the saddle max-ridge distance).
 */
function neighborhoodRelevanceBbox(
  parcelRings: number[][][],
  extraMarginM: number = 0,
): [number, number, number, number] {
  const flat = parcelRings.flat();
  const parcelBbox = getBbox(flat);
  const centroid = getCentroid(flat);
  // A-300 hunt-zone box centered on the parcel centroid (the flow/map window).
  const floorBbox = expandBbox(
    [centroid[0], centroid[1], centroid[0], centroid[1]],
    NEIGHBORHOOD_VERDICT_RADIUS_M,
  );
  // Union so large parcels keep their own bigger window; small parcels get floored.
  const unioned: [number, number, number, number] = [
    Math.min(parcelBbox[0], floorBbox[0]),
    Math.min(parcelBbox[1], floorBbox[1]),
    Math.max(parcelBbox[2], floorBbox[2]),
    Math.max(parcelBbox[3], floorBbox[3]),
  ];
  return expandBbox(unioned, RIDGE_RELEVANCE_MARGIN_M + extraMarginM);
}

// ── Honest-flow gates (v6.4): stop the saddle-crossing lattice from standing in
// for a real ridge network on starved parcels — the "wiggly rectangles following
// roads" failure. CALIBRATED BY EVIDENCE (Jul 16 probe spread), not feel:
//   Putnam artifact  → 1 traced line @ 49-53 ft feeding 4-6 saddle crossings.
//   warren/osage/fr. → 1 traced line @ 66-113 ft (genuine strong lone spine).
//   callaway/gascon. → 2-3 traced lines @ 45-48 ft (real moderate network).
//   Dietzfelbinger   → 7 traced lines @ 85 ft, 10 crossings (healthy, ~1.4:1).
// Rule A (crossing discipline): saddle crossings SUPPLEMENT a ridge network,
//   never constitute it. Require a real multi-line network (>= MIN_NETWORK) before
//   drawing any crossing, and cap crossings at RATIO x traced-line count so they
//   can never dominate (the artifact ran 4-6 crossings on a single line). The
//   RATIO=2 ceiling leaves healthy parcels (Dietz 10<=14) byte-for-byte unchanged.
// Rule B (starved -> honest-empty): a lone traced line below the lone-spine
//   prominence bar is the Putnam artifact, not a flow story -> read empty. A
//   genuine strong lone spine (>= bar) still draws. Bar sits between the artifact
//   ceiling (53 ft) and the lowest genuine lone spine kept (66 ft), biased low to
//   avoid the over-correction the old 50 ft floor caused on moderate ground.
const FLOW_CROSS_MIN_NETWORK = Number(process.env.FLOW_CROSS_MIN_NETWORK || 2);
const FLOW_CROSS_RATIO = Number(process.env.FLOW_CROSS_RATIO || 2);
const FLOW_LONE_SPINE_MIN_FT = Number(process.env.FLOW_LONE_SPINE_MIN_FT || 60);

interface RidgeFeatureLite {
  coords: [number, number][];
  prominenceFt: number;
  ridgeScore: number;
  lengthMeters: number;
  // READ-ONLY flank-relief diagnostic from the ridge service (v3.1): bilateral,
  // at-distance (125m), sustained (median over stations) cross-sectional drop.
  flankReliefFt: number;
  flankStations: number;
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
      flankReliefFt: Number(p.flankReliefFt) || 0,
      flankStations: Number(p.flankStations) || 0,
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
  maxProminenceFt: number;
  // Count of prominence-qualified network lines (each ridge >= NETWORK_LINE_MIN_FT).
  // Feeds the shared backbone verdict's multi-line side (NOT the raw line count).
  strongLineCount: number;
  // READ-ONLY DIAGNOSTIC: prominences (ft, rounded, desc) of every parcel-relevant
  // traced ridge line (primary+secondary) AFTER the relevance filter, BEFORE the
  // per-line 40ft qualification. Empty on the pre-relevance early returns.
  linePromsFt: number[];
  // READ-ONLY DIAGNOSTIC (length/continuity calibration): per-line spine length (m)
  // and ridge-service coherence score (avgRidgeScore), aligned index-for-index with
  // linePromsFt so a given spine's prominence/length/coherence line up. Empty on the
  // pre-relevance early returns.
  lineLensM: number[];
  lineCoherence: number[];
  // READ-ONLY DIAGNOSTIC (flank-relief calibration): per-line bilateral flank
  // relief (ft) aligned index-for-index with linePromsFt. Empty on pre-relevance
  // early returns.
  lineFlankFt: number[];
} {
  const primaryRidgesAll = extractRidgeFeatures(ridgeData?.ridges_primary);
  const secondaryRidgesAll = extractRidgeFeatures(ridgeData?.ridges_secondary);

  if (primaryRidgesAll.length === 0 && secondaryRidgesAll.length === 0) {
    console.log('[RidgeTrace] No ridge geometry — empty flow (honest gate).');
    return { primary: [], secondary: [], maxProminenceFt: 0, strongLineCount: 0, linePromsFt: [], lineLensM: [], lineCoherence: [], lineFlankFt: [] };
  }

  // The ridge service returns spines for a large buffered window (up to ~1 km
  // around the parcel). Scope to the NEIGHBORHOOD window (A-300 hunt-zone floor,
  // unioned with the parcel bbox) BEFORE both the honest gate and tracing, so the
  // verdict is judged on the same neighborhood terrain the flow/map render on —
  // small parcels no longer under-read the surrounding ridges. gate-pass ⟺ at
  // least one traceable ridge in the neighborhood window.
  const relevanceBbox = neighborhoodRelevanceBbox(parcelRings);
  const primaryRidges = primaryRidgesAll.filter((r) => polylineInBbox(r.coords, relevanceBbox));
  const secondaryRidges = secondaryRidgesAll.filter((r) => polylineInBbox(r.coords, relevanceBbox));

  if (primaryRidges.length === 0 && secondaryRidges.length === 0) {
    console.log('[RidgeTrace] No ridge in neighborhood window (A-300 floor) — empty flow (honest gate).');
    return { primary: [], secondary: [], maxProminenceFt: 0, strongLineCount: 0, linePromsFt: [], lineLensM: [], lineCoherence: [], lineFlankFt: [] };
  }

  // Honest gate (v5.2): require measured relief above the prominence floor on
  // EITHER tier, evaluated over the parcel-relevant ridges. Sub-floor parcels
  // (flat ag / gate fails) read empty — never a centroid template fallback.
  const PROMINENCE_FLOOR_FT = Number(process.env.FLOW_PROMINENCE_FLOOR_FT || 32);
  const maxProminenceFt = [...primaryRidges, ...secondaryRidges].reduce(
    (m, r) => Math.max(m, r.prominenceFt),
    0
  );
  // READ-ONLY DIAGNOSTIC: per-line prominences over the exact relevance-filtered
  // set maxProminenceFt/strongLineCount are derived from (desc, rounded). Computed
  // here so even a stage-1 sub-floor early return can report the real spine ft.
  // Sort ONCE by prominence desc, then derive proms/lengths/coherence in the SAME
  // order so a spine's prominence, length (m), and coherence align index-for-index.
  const relevantLinesSorted = [...primaryRidges, ...secondaryRidges]
    .slice()
    .sort((a, b) => b.prominenceFt - a.prominenceFt);
  const linePromsFt = relevantLinesSorted.map((r) => Math.round(r.prominenceFt));
  const lineLensM = relevantLinesSorted.map((r) => Math.round(r.lengthMeters));
  const lineCoherence = relevantLinesSorted.map((r) => Math.round(r.ridgeScore * 1000) / 1000);
  const lineFlankFt = relevantLinesSorted.map((r) => Math.round(r.flankReliefFt));
  if (maxProminenceFt < PROMINENCE_FLOOR_FT) {
    console.log(
      '[RidgeTrace] Max relevant ridge prominence %d ft < floor %d ft — empty flow (honest gate). perLineProms=[%s] lensM=[%s] coh=[%s] flankFt=[%s]',
      Math.round(maxProminenceFt),
      PROMINENCE_FLOOR_FT,
      linePromsFt.join(','),
      lineLensM.join(','),
      lineCoherence.join(','),
      lineFlankFt.join(',')
    );
    return { primary: [], secondary: [], maxProminenceFt, strongLineCount: 0, linePromsFt, lineLensM, lineCoherence, lineFlankFt };
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

  // Count PROMINENCE-QUALIFIED network lines: mirror the exact set buildTier
  // renders (same relevance filter + per-tier prominence sort + cap) and keep
  // only ridges whose individual prominence clears the per-line network floor.
  // This is what feeds the shared backbone verdict's multi-line side, so a flat
  // parcel emitting several weak sub-floor artifact spines can't clear the gate
  // on raw count alone.
  const strongInTier = (ridges: RidgeFeatureLite[]) =>
    ridges
      .slice()
      .sort((a, b) => b.prominenceFt - a.prominenceFt)
      .slice(0, RIDGE_TRACE_MAX_PER_TIER)
      .filter((r) => r.prominenceFt >= NETWORK_LINE_MIN_FT).length;
  const strongLineCount = strongInTier(primaryRidges) + strongInTier(secondaryRidges);

  console.log(
    '[RidgeTrace] Traced %d primary + %d secondary flow lines from real ridges (maxProm=%d ft, %d prominence-qualified >=%dft). perLineProms=[%s] lensM=[%s] coh=[%s] flankFt=[%s]',
    primary.length,
    secondary.length,
    Math.round(maxProminenceFt),
    strongLineCount,
    NETWORK_LINE_MIN_FT,
    linePromsFt.join(','),
    lineLensM.join(','),
    lineCoherence.join(','),
    lineFlankFt.join(',')
  );

  return { primary, secondary, maxProminenceFt, strongLineCount, linePromsFt, lineLensM, lineCoherence, lineFlankFt };
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
  scale: ParcelScaleMetrics,
  maxCrossings?: number
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

  // Cheap pre-filter window. Traced ridges already live within the neighborhood
  // window; a valid saddle only needs to be within SADDLE_MAX_RIDGE_DIST_M of one
  // of them, so widen the pre-filter by that reach to avoid clipping edge saddles.
  // The real relevance gate is the distance-to-traced-ridge test below.
  const relevanceBbox = neighborhoodRelevanceBbox(parcelRings, SADDLE_MAX_RIDGE_DIST_M);
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
    .slice(0, Math.min(SADDLE_MAX_CROSSINGS, maxCrossings ?? SADDLE_MAX_CROSSINGS));

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

// ========== PHASE 4: VISUAL POLISH (flank offset + smoothing) ==========
//
// PURELY COSMETIC. This pass changes how the flow lines LOOK, never which
// ridges/saddles are traced, the honest gate, or the convergence scoring.
// Critically it runs AFTER deriveConvergenceFromNetwork() in the main entry, so
// the Phase 3 convergence network is computed on the RAW traced geometry and is
// left byte-for-byte unchanged by everything here.
//
// Two transforms, both faithful to the real terrain:
//   1. Flank offset — deer walk the sidehill bench just below the crest, not the
//      razor's edge. We nudge each ridge-spine flow a modest, uniform distance to
//      one side of the crest so the line sits BESIDE the ridge. Saddle crossings
//      are NOT offset — they must keep passing through the real gap to meet the
//      ridge lines. (Precise leeward/aspect-aware side selection is a later
//      refinement; a clean modest offset is the Phase 4 bar.)
//   2. Smoothing — the raw ridge polylines are jagged (DEM vertices). Chaikin
//      corner-cutting rounds the jitter into natural travel curves. Chaikin stays
//      strictly INSIDE the polyline's own envelope (each new point is a convex
//      blend of two real vertices), so it can NEVER bow the line off the ridge —
//      it only interpolates between real points. Endpoints are preserved so the
//      line still begins/ends on the real ridge. Applied to the saddle crossings
//      too, it rounds the [flank → saddle → flank] elbow so ridge → cross → ridge
//      reads as one continuous, natural path instead of a sharp V.

// Modest sidehill offset (m): deer walk the bench just below the crest. Tunable.
const FLANK_OFFSET_M = Number(process.env.FLOW_FLANK_OFFSET_M || 14);
// Chaikin smoothing iterations (2 = smooth curves with controlled vertex growth).
const SMOOTH_ITERATIONS = Number(process.env.FLOW_SMOOTH_ITERATIONS || 2);

/**
 * Chaikin corner-cutting smoothing for an open polyline. Each iteration replaces
 * every interior corner with two points at the classic 1/4 and 3/4 positions of
 * each segment — a convex blend of two REAL vertices, so the smoothed curve can
 * never leave the polyline's own envelope (it interpolates between real points,
 * it does not invent an overshooting curve). First and last vertices are kept so
 * the line still starts and ends exactly on the real ridge geometry.
 */
function chaikinSmooth(coords: [number, number][], iterations: number): [number, number][] {
  if (coords.length < 3 || iterations <= 0) return coords;
  let pts = coords;
  for (let it = 0; it < iterations; it++) {
    const next: [number, number][] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      next.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      next.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

// ========== PHASE 5 ("Wake Up the Land") STEP 1: FLOWING FORM ==========
//
// The Phase-2 crossings are built as a straight bar [flankA, saddle, flankB]
// drawn PERPENDICULAR to the ridge. Rendered next to the ridge line that also
// runs through that saddle, the bar T-bones the ridge at ~90°. Here we reshape
// each crossing (VISUAL ONLY, post-convergence) into a smooth curve that passes
// through the real saddle TANGENT to the ridge axis, then peels off into each
// flank — so ridge → saddle → ridge reads as one continuous flowing travel path
// with no right angle. Honest: the curve is anchored on the SAME three real
// points (flankA, saddle, flankB) the straight bar used and only interpolates
// between them (same Chaikin convex-envelope principle) — it never bows onto
// terrain the crossing did not already touch.

// Sampled points per crossing arm (pre-Chaikin). 8 = smooth without vertex bloat.
const CROSSING_ARM_SAMPLES = 8;
// Ridge-tangent handle length as a fraction of the arm chord. Keeps the curve
// rounded but controlled so it can't overshoot past the flank end.
const CROSSING_TANGENT_SCALE = 0.55;

/**
 * Cubic Hermite interpolation between P0 and P1 with endpoint tangents M0, M1,
 * sampled at (samples+1) points (t = 0..1 inclusive). Works in lng/lat degree
 * space; over the short crossing spans (<~100 m) the planar error is sub-metre.
 */
function hermiteSample(
  P0: [number, number], P1: [number, number],
  M0: [number, number], M1: [number, number],
  samples: number
): [number, number][] {
  const out: [number, number][] = [];
  for (let s = 0; s <= samples; s++) {
    const t = s / samples;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    out.push([
      h00 * P0[0] + h10 * M0[0] + h01 * P1[0] + h11 * M1[0],
      h00 * P0[1] + h10 * M0[1] + h01 * P1[1] + h11 * M1[1],
    ]);
  }
  return out;
}

/**
 * Reshape a straight Phase-2 saddle crossing [flankA, saddle, flankB] into a
 * smooth curve that runs through the real saddle TANGENT to the ridge axis, then
 * curves off into each flank. This kills the 90° T-bone: at the saddle the
 * crossing now runs PARALLEL to the ridge, so ridge → saddle → ridge reads as one
 * continuous flowing path. Honest — the curve is anchored on the same three real
 * points and only interpolates between them.
 */
function tangentializeCrossing(coords: [number, number][]): [number, number][] {
  if (coords.length < 3) return coords;
  const flankA = coords[0];
  const saddle = coords[1];
  const flankB = coords[coords.length - 1];

  // Recover the ridge axis at the saddle from the crossing's own geometry: the
  // straight bar was drawn perpendicular to the ridge, so ridge bearing =
  // crossing bearing − 90°.
  const crossingBearing = calculateBearing(saddle, flankB);
  const ridgeBearing = (crossingBearing - 90 + 360) % 360;
  // Unit ridge-direction vector in degree space (1 m step, lat-corrected).
  const ridgeStep = movePoint(saddle, ridgeBearing, 1);
  const ridgeVec: [number, number] = [ridgeStep[0] - saddle[0], ridgeStep[1] - saddle[1]];

  const lenA = distanceMeters(flankA, saddle);
  const lenB = distanceMeters(saddle, flankB);
  // Degree-space magnitude of a 1 m ridge step (so ridgeVec * meters ≈ that span).
  const scaleA = lenA * CROSSING_TANGENT_SCALE;
  const scaleB = lenB * CROSSING_TANGENT_SCALE;

  // Arm A: flankA → saddle. Approach tangent at flankA is the chord (gentle in);
  // tangent at the saddle runs ALONG the ridge (tangential merge).
  const m0A: [number, number] = [saddle[0] - flankA[0], saddle[1] - flankA[1]];
  const m1A: [number, number] = [ridgeVec[0] * scaleA, ridgeVec[1] * scaleA];
  const armA = hermiteSample(flankA, saddle, m0A, m1A, CROSSING_ARM_SAMPLES);

  // Arm B: saddle → flankB. Tangent at the saddle CONTINUES along the ridge (same
  // direction as arm A's end tangent → C1-smooth through the saddle); tangent at
  // flankB is the chord out into the flank.
  const m0B: [number, number] = [ridgeVec[0] * scaleB, ridgeVec[1] * scaleB];
  const m1B: [number, number] = [flankB[0] - saddle[0], flankB[1] - saddle[1]];
  const armB = hermiteSample(saddle, flankB, m0B, m1B, CROSSING_ARM_SAMPLES);

  // Concatenate; drop the duplicate saddle vertex at the arm join.
  return [...armA, ...armB.slice(1)];
}

/**
 * Apply the visual polish to a set of flow features. Ridge-spine flows are
 * offset to the flank then smoothed; saddle crossings are first curved into a
 * tangential ridge merge (Phase 5 Step 1) then smoothed, so they flow into the
 * ridge instead of T-boning it. lengthM is refreshed for display; every other
 * property (id, tier, likelihood, …) is preserved exactly. Geometry is only
 * reshaped between/around real vertices — no feature is added, removed, or
 * relocated off its ridge.
 */
function polishFlowGeometry(
  feats: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[]
): GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] {
  return feats.map((f) => {
    const isSaddleCrossing = f.properties.id.startsWith('flow_saddle_');
    let coords = f.geometry.coordinates as [number, number][];
    if (isSaddleCrossing) {
      // Tangential merge (kill the 90° T-bone) then round.
      coords = tangentializeCrossing(coords);
    } else if (FLANK_OFFSET_M > 0) {
      coords = offsetRidgeToFlank(coords, FLANK_OFFSET_M);
    }
    coords = chaikinSmooth(coords, SMOOTH_ITERATIONS);
    return {
      ...f,
      properties: { ...f.properties, lengthM: Math.round(computeLineLength(coords)) },
      geometry: { type: 'LineString' as const, coordinates: coords },
    };
  });
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
  // Shared backbone verdict — computed ONCE here from the traced ridge network
  // and stamped into the response metadata below so the terrain STORY consults
  // the exact same determination (see lib/terrain-backbone.ts). Defaults to a
  // permissive verdict for the retired legacy template path.
  let backboneVerdict: BackboneVerdict = {
    hasRealBackbone: true,
    state: 'confirmed',
    networkLines: 0,
    maxProminenceFt: 0,
    reason: 'not assessed (legacy template path)',
  };
  if (RIDGE_TRACE_ENABLED) {
    let maxProminenceFt: number;
    let strongLineCount: number;
    let linePromsFt: number[];
    let lineLensM: number[];
    let lineCoherence: number[];
    let lineFlankFt: number[];
    ({ primary, secondary, maxProminenceFt, strongLineCount, linePromsFt, lineLensM, lineCoherence, lineFlankFt } = traceFlowFromRidges(ridgeData, parcelRings, parcelScale));
    const realLines = primary.length + secondary.length;
    // Shared no-backbone verdict (Rule B, starved -> honest-empty). The network
    // side now counts only lines that clear a real PER-LINE prominence floor
    // (NETWORK_LINE_MIN_FT via strongLineCount) rather than a raw traced-line
    // count: flat-ag artifacts can produce 2-3 low spurs that used to clear the
    // network side on raw count and draw a lattice. A thin qualified network
    // (<=1 line clearing the per-line floor) whose single spine is below the
    // lone-spine prominence bar is an artifact, not terrain. This SAME verdict
    // is stamped into metadata.backbone so the story reads low-relief rather
    // than re-deriving structure from raw saddle counts.
    backboneVerdict = assessBackbone(strongLineCount, maxProminenceFt, FLOW_LONE_SPINE_MIN_FT);
    // READ-ONLY DIAGNOSTIC: attach the parcel-relevant per-line prominences, lengths
    // (m), and coherence so the route can surface them in terrain_debug + the
    // ScopeProbe log line (all aligned index-for-index with linePromsFt).
    backboneVerdict.linePromsFt = linePromsFt;
    backboneVerdict.lineLensM = lineLensM;
    backboneVerdict.lineCoherence = lineCoherence;
    backboneVerdict.lineFlankFt = lineFlankFt;
    if (!backboneVerdict.hasRealBackbone) {
      console.log('[RidgeTrace] Starved network — honest-empty flow. %s', backboneVerdict.reason);
      primary = [];
      secondary = [];
    } else if (SADDLE_CROSSINGS_ENABLED && realLines >= FLOW_CROSS_MIN_NETWORK) {
      // Rule A (crossing discipline): saddle crossings SUPPLEMENT a real network
      // (>= FLOW_CROSS_MIN_NETWORK traced lines) and are capped at
      // FLOW_CROSS_RATIO x realLines so they can never outnumber the spines that
      // justify them. A lone real spine draws clean (no lattice).
      const maxCrossings = Math.round(FLOW_CROSS_RATIO * realLines);
      const cross = traceSaddleCrossings(ridgeData, [...primary, ...secondary], parcelRings, parcelScale, maxCrossings);
      primary.push(...cross.primary);
      secondary.push(...cross.secondary);
    }
  } else {
    // Retired legacy template (escape hatch only).
    ({ primary, secondary } = generatePatternBasedFlow(coords, pattern, parcelScale));
  }
  
  // Generate convergence zones from the REAL traced network (Phase 3) — pass all
  // rings for multi-parcel containment plus ridgeData for saddle-depth signal.
  const convergenceZones = deriveConvergenceFromNetwork(primary, secondary, parcelRings, parcelScale, ridgeData);

  // Phase 4: PURELY-VISUAL polish. Runs AFTER convergence derivation above, so
  // the Phase 3 network is scored on the raw traced geometry and stays unchanged.
  // Nudges ridge-spine flows onto the sidehill flank and smooths every line
  // (ridge + saddle crossing) into natural travel curves. No line is relocated
  // off its real ridge; smoothing only interpolates between real DEM vertices.
  primary = polishFlowGeometry(primary);
  secondary = polishFlowGeometry(secondary);
  
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
      // Shared "is there a real backbone?" verdict — consulted by the terrain
      // story so flow (honest-empty vs. draw) and story (low-relief vs.
      // structured) can never contradict each other.
      backbone: backboneVerdict,
    },
  };
}

// ========== CONVERGENCE AND OPPORTUNITY ==========

// ---- Phase 3 geometry helpers ----

/** Planar segment/segment intersection (local lng/lat approx). Returns the
 *  intersection point only when both segments genuinely cross (params in [0,1]). */
function segmentIntersection(
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number]
): [number, number] | null {
  const x1 = p1[0], y1 = p1[1], x2 = p2[0], y2 = p2[1];
  const x3 = p3[0], y3 = p3[1], x4 = p4[0], y4 = p4[1];
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-14) return null; // parallel / degenerate
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

/** Acute crossing angle (deg, 0-90) between two segments. 90 = perpendicular. */
function segmentCrossAngle(
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number]
): number {
  const b1 = calculateBearing(p1, p2);
  const b2 = calculateBearing(p3, p4);
  let d = Math.abs(b1 - b2) % 180;
  if (d > 90) d = 180 - d;
  return d;
}

interface ConvergenceCandidate {
  coord: [number, number];
  intensity: number;              // continuous 0-1, NEVER pinned to 1.0
  corridorCount: number;          // real corridors meeting here
  type: ConvergenceZoneProperties['type'];
}

/**
 * PHASE 3 — REAL CONVERGENCE.
 *
 * Retires the quantized fake (intensity pinned at ~0.7-1.0, additive 0.15 steps,
 * count/5 clamp). A convergence zone is now a place where the REAL traced network
 * genuinely meets or pinches, derived from three honest sources:
 *
 *   1. Saddle crossings — deer funnel through the real gap. Signal = saddle depth
 *      (ridgeDropFt) + how many corridors meet there.
 *   2. Ridge junctions — where two traced ridge spines converge (tip-to-body
 *      approach). Signal = closeness + spine strength + corridors meeting.
 *   3. True flow-line intersections — genuine segment crossings of the traced
 *      lines. Signal = crossing angle (perpendicular pinches harder) + corridors.
 *
 * Intensity is scored CONTINUOUSLY from real signal so the number varies smoothly
 * with terrain instead of snapping to 10% steps. Honest gate: no real meeting
 * point → zero zones (never a planted parcel-center marker).
 */
function deriveConvergenceFromNetwork(
  primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[],
  secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[],
  parcelRings: number[][][],
  scale: ParcelScaleMetrics,
  ridgeData: any
): GeoJSON.Feature<GeoJSON.Point, ConvergenceZoneProperties>[] {
  const allFlows = [...primary, ...secondary];
  if (allFlows.length < 1) return [];

  const isSaddleFlow = (f: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>) =>
    f.properties.id.startsWith('flow_saddle_');
  const saddleFlows = allFlows.filter(isSaddleFlow);
  const spineFlows = allFlows.filter((f) => !isSaddleFlow(f));

  // How many DISTINCT corridors have a vertex within R of a coord.
  const meetRadius = Math.max(55, Math.round((scale.convergenceSearchRadius || 90) * 0.6));
  const corridorsNear = (coord: [number, number]): number => {
    let n = 0;
    for (const f of allFlows) {
      const cs = f.geometry.coordinates as [number, number][];
      let dmin = Infinity;
      for (const c of cs) {
        const d = distanceMeters(coord, c);
        if (d < dmin) dmin = d;
      }
      if (dmin <= meetRadius) n++;
    }
    return n;
  };
  // Smoothly map "corridors meeting" (2+) into 0-1 without hard steps.
  const meetNorm = (count: number) => Math.min(1, Math.max(0, count - 1) / 3);

  const candidates: ConvergenceCandidate[] = [];

  // ===== Source 1: Saddle crossings (deer funnel through the gap) =====
  const saddleNodes = extractSaddleNodes(ridgeData?.saddle_nodes);
  for (const sf of saddleFlows) {
    const cs = sf.geometry.coordinates as [number, number][];
    // The crossing is built as [flankA, saddlePoint, flankB]; the saddle sits mid.
    const saddlePt = cs[Math.floor(cs.length / 2)] ?? cs[0];
    if (!pointInAnyRing(saddlePt, parcelRings)) continue;
    // Recover the real saddle depth from the nearest service saddle node.
    let dropFt = 0;
    let bestD = Infinity;
    for (const s of saddleNodes) {
      const d = distanceMeters(saddlePt, s.coord);
      if (d < bestD) { bestD = d; dropFt = s.ridgeDropFt; }
    }
    const depthNorm = Math.min(1, dropFt / SADDLE_DROP_NORM_FT); // 80ft ceiling
    const count = corridorsNear(saddlePt);
    // A saddle crossing is inherently a funnel: modest baseline, then real signal.
    const intensity = Math.max(0.05, Math.min(1,
      0.22 + depthNorm * 0.48 + meetNorm(count) * 0.30
    ));
    candidates.push({ coord: saddlePt, intensity, corridorCount: Math.max(2, count), type: 'saddle' });
  }

  // ===== Source 2: Ridge junctions (traced spines converge) =====
  // A junction is where one spine's TIP approaches another spine (Y/T meets).
  const JUNCTION_DIST_M = Math.max(60, Math.round((scale.convergenceSearchRadius || 90) * 0.8));
  const spineLikelihood = (f: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>) =>
    Math.max(0, Math.min(1, f.properties.likelihood || 0.5));
  for (let i = 0; i < spineFlows.length; i++) {
    const a = spineFlows[i].geometry.coordinates as [number, number][];
    if (a.length < 2) continue;
    const tips: [number, number][] = [a[0], a[a.length - 1]];
    for (let j = 0; j < spineFlows.length; j++) {
      if (j === i) continue;
      const b = spineFlows[j].geometry.coordinates as [number, number][];
      if (b.length < 2) continue;
      for (const tip of tips) {
        // nearest point on spine b to this tip
        let dMin = Infinity;
        let near: [number, number] = b[0];
        for (const c of b) {
          const d = distanceMeters(tip, c);
          if (d < dMin) { dMin = d; near = c; }
        }
        if (dMin > JUNCTION_DIST_M) continue;
        const node: [number, number] = [(tip[0] + near[0]) / 2, (tip[1] + near[1]) / 2];
        if (!pointInAnyRing(node, parcelRings)) continue;
        const closeNorm = 1 - dMin / JUNCTION_DIST_M;
        const promNorm = (spineLikelihood(spineFlows[i]) + spineLikelihood(spineFlows[j])) / 2;
        const count = corridorsNear(node);
        const intensity = Math.max(0.05, Math.min(1,
          0.18 + closeNorm * 0.32 + promNorm * 0.28 + meetNorm(count) * 0.22
        ));
        candidates.push({ coord: node, intensity, corridorCount: Math.max(2, count), type: count >= 3 ? 'pinch' : 'overlap' });
      }
    }
  }

  // ===== Source 3: True flow-line intersections (genuine segment crossings) =====
  for (let i = 0; i < allFlows.length; i++) {
    const a = allFlows[i].geometry.coordinates as [number, number][];
    if (a.length < 2) continue;
    const abox = getBbox(a);
    for (let j = i + 1; j < allFlows.length; j++) {
      const b = allFlows[j].geometry.coordinates as [number, number][];
      if (b.length < 2) continue;
      const bbox = getBbox(b);
      // cheap bbox overlap prefilter
      if (abox[2] < bbox[0] || bbox[2] < abox[0] || abox[3] < bbox[1] || bbox[3] < abox[1]) continue;
      for (let m = 0; m < a.length - 1; m++) {
        for (let n = 0; n < b.length - 1; n++) {
          const hit = segmentIntersection(a[m], a[m + 1], b[n], b[n + 1]);
          if (!hit) continue;
          if (!pointInAnyRing(hit, parcelRings)) continue;
          const angle = segmentCrossAngle(a[m], a[m + 1], b[n], b[n + 1]);
          const angleNorm = Math.sin((angle * Math.PI) / 180); // perpendicular -> 1
          const count = corridorsNear(hit);
          const intensity = Math.max(0.05, Math.min(1,
            0.20 + angleNorm * 0.42 + meetNorm(count) * 0.30
          ));
          candidates.push({ coord: hit, intensity, corridorCount: Math.max(2, count), type: count >= 3 ? 'pinch' : 'overlap' });
        }
      }
    }
  }

  if (candidates.length === 0) return [];

  // Merge candidates that describe the same physical meeting point. Keep the
  // strongest signal (max intensity / max corridor count) — NO additive
  // accumulation, so intensity can never saturate to a fake 1.0.
  const mergeR = Math.max(45, Math.round((scale.convergenceSearchRadius || 90) * 0.5));
  candidates.sort((a, b) => b.intensity - a.intensity);
  const merged: ConvergenceCandidate[] = [];
  for (const c of candidates) {
    const near = merged.find((m) => distanceMeters(m.coord, c.coord) < mergeR);
    if (near) {
      near.corridorCount = Math.max(near.corridorCount, c.corridorCount);
      // 'saddle' type is the most descriptive; keep it if either says saddle.
      if (c.type === 'saddle') near.type = 'saddle';
      else if (near.type !== 'saddle' && c.type === 'pinch') near.type = 'pinch';
    } else {
      merged.push({ ...c });
    }
  }

  merged.sort((a, b) => b.intensity - a.intensity);
  return merged.slice(0, scale.maxConvergenceZones).map((c, idx) => {
    const cappedCount = Math.min(4, c.corridorCount);
    return {
      type: 'Feature' as const,
      properties: {
        id: `conv_${idx}`,
        intensity: c.intensity,
        flowCount: cappedCount,
        radiusM: scale.convergenceBaseRadius +
          (scale.isTerritory && scale.areaAcres >= 3000 ? cappedCount : c.corridorCount) * 10,
        type: c.type,
      },
      geometry: { type: 'Point' as const, coordinates: c.coord },
    };
  });
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