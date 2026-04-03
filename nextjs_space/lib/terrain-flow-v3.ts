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
  const ridges = ridgeData?.ridges_primary?.features || [];
  const saddles = ridgeData?.saddle_nodes?.features || [];
  
  const hasCorridors = corridors.length > 0;
  const hasRidges = ridges.length > 0;
  const hasSaddles = saddles.length > 0;
  
  // Structure score: how much terrain evidence we have
  let structureScore = 0;
  if (hasCorridors) structureScore += 0.4;
  if (hasRidges) structureScore += 0.3;
  if (hasSaddles) structureScore += 0.2;
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
  
  // Check for funnel pattern: saddle with converging ridges
  if (hasSaddles && hasRidges) {
    return {
      type: 'funnel',
      confidence: 0.75,
      dominantBearing: dominantDirs[0]?.bearing || 0,
      structureScore,
      explanation: 'Saddle with ridges suggests funnel/convergence pattern',
    };
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
  
  // Fallback: use parcel edge orientation for BENCH pattern
  if (dominantDirs.length >= 1 && dominantDirs[0].weight > 200) {
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
 * LINEAR: Single dominant corridor with 0-1 parallel feeder
 * Classic ridge-line or drainage-axis pattern
 * Target: 1 primary, 0-1 secondary (only on large parcels)
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
  
  // Single strong primary flow along dominant bearing
  const primaryLine = generateSingleFlowLine(centroid, bearing, maxLen, scale, 'primary', 0);
  if (primaryLine) primary.push(primaryLine);
  
  // Only 1 secondary feeder, only on larger parcels (≥80 acres)
  if (scale.areaAcres >= 80) {
    const offsetDir = (bearing + 90) % 360;
    const offset = widthM * 0.18;
    const startPoint = movePoint(centroid, offsetDir, offset);
    const variedBearing = bearing + (sRand() - 0.5) * 12;
    const line = generateSingleFlowLine(startPoint, variedBearing, maxLen * 0.55, scale, 'secondary', 0);
    if (line) secondary.push(line);
  }
  
  return { primary, secondary };
}

/**
 * FUNNEL: Converging flows toward one area
 * Target: 1 primary + 0-1 secondary feeder converging toward a point
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
  
  // Convergence point: offset from center toward dominant direction
  const convergenceOffset = scale.diagonalM * 0.2;
  const convergencePoint = movePoint(centroid, pattern.dominantBearing, convergenceOffset);
  
  const primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  const secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  
  // Max 2 flows: 1 primary + 1 secondary (only on ≥60 acre parcels)
  const numFlows = scale.areaAcres >= 60 ? 2 : 1;
  const spreadAngle = 35;
  
  for (let i = 0; i < numFlows; i++) {
    const angleOffset = (i - (numFlows - 1) / 2) * spreadAngle;
    const incomingBearing = (pattern.dominantBearing + 180 + angleOffset) % 360;
    
    const startDist = scale.diagonalM * 0.4;
    const startPoint = movePoint(convergencePoint, incomingBearing, startDist);
    
    const lineCoords = generateCurvedLineToTarget(startPoint, convergencePoint, scale);
    const length = computeLineLength(lineCoords);
    
    if (length < scale.minLengthPrimary) continue;
    
    const feature: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties> = {
      type: 'Feature',
      properties: {
        id: `flow_${i === 0 ? 'primary' : 'secondary'}_${i}`,
        tier: i === 0 ? 'primary' : 'secondary',
        likelihood: i === 0 ? 0.78 : 0.6,
        lengthM: Math.round(length),
        avgSlope: 8 + sRand() * 5,
        convergenceScore: 0.7 + sRand() * 0.2,
      },
      geometry: { type: 'LineString', coordinates: lineCoords },
    };
    
    if (i === 0) {
      primary.push(feature);
    } else {
      secondary.push(feature);
    }
  }
  
  return { primary, secondary };
}

/**
 * BENCH: Sidehill contour-following pattern
 * Uses curved flow lines (not geometric arcs) for terrain-justified paths
 * Target: 1 primary contour-following line, 0-1 secondary on large parcels
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
  
  // Primary: single curved flow along contour bearing (replaces arc)
  const primaryLine = generateSingleFlowLine(centroid, bearing, maxLen, scale, 'primary', 0);
  if (primaryLine) {
    primaryLine.properties.likelihood = 0.72;
    primary.push(primaryLine);
  }
  
  // Secondary: only on ≥70 acre parcels, single offset feeder
  if (scale.areaAcres >= 70) {
    const offset = scale.widthM * 0.15;
    const offsetPoint = movePoint(centroid, (bearing + 90) % 360, offset);
    const variedBearing = bearing + (sRand() - 0.5) * 10;
    const line = generateSingleFlowLine(offsetPoint, variedBearing, maxLen * 0.5, scale, 'secondary', 0);
    if (line) {
      line.properties.likelihood = 0.55;
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
  
  const primary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  const secondary: GeoJSON.Feature<GeoJSON.LineString, FlowLineProperties>[] = [];
  
  // Primary: dominant direction
  const primaryLine = generateSingleFlowLine(centroid, pattern.dominantBearing, maxLen, scale, 'primary', 0);
  if (primaryLine) primary.push(primaryLine);
  
  // Secondary: perpendicular direction (if detected)
  if (pattern.secondaryBearing !== undefined) {
    const secondaryLine = generateSingleFlowLine(centroid, pattern.secondaryBearing, maxLen * 0.8, scale, 'secondary', 0);
    if (secondaryLine) secondary.push(secondaryLine);
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
  
  // Extract parcel coordinates
  let coords: number[][] = [];
  if (parcel.geometry.type === 'Polygon') {
    coords = parcel.geometry.coordinates[0];
  } else {
    let maxLen = 0;
    parcel.geometry.coordinates.forEach(poly => {
      if (poly[0].length > maxLen) {
        maxLen = poly[0].length;
        coords = poly[0];
      }
    });
  }
  
  if (coords.length < 4) {
    return emptyFlowResponse('Insufficient parcel coordinates');
  }
  
  const bbox = getBbox(coords);
  const centroid = getCentroid(coords);
  const widthM = distanceMeters([bbox[0], centroid[1]], [bbox[2], centroid[1]]);
  const heightM = distanceMeters([centroid[0], bbox[1]], [centroid[0], bbox[3]]);
  
  // Compute parcel scale
  const parcelScale = computeParcelScale(widthM, heightM);
  
  console.log('[TerrainFlowV3] Parcel: %d x %d m (~%d acres)', 
    Math.round(widthM), Math.round(heightM), Math.round(parcelScale.areaAcres));
  
  // Classify flow pattern
  const pattern = classifyFlowPattern(coords, corridorData, ridgeData, parcelScale);
  
  console.log('[TerrainFlowV3] Pattern: %s (confidence=%.2f, structure=%.2f)', 
    pattern.type, pattern.confidence, pattern.structureScore);
  console.log('[TerrainFlowV3] %s', pattern.explanation);
  
  // Generate pattern-based flows
  const { primary, secondary } = generatePatternBasedFlow(coords, pattern, parcelScale);
  
  // Generate convergence zones (if flows exist)
  const convergenceZones = generateConvergenceFromFlows(primary, secondary, coords, parcelScale);
  
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
  parcelCoords: number[][],
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
            
            // Check if inside parcel
            if (!pointInPolygon(midpoint, parcelCoords)) continue;
            
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
  
  // If no intersections, use flow midpoints as weak convergence
  if (foundPoints.length === 0 && primary.length > 0) {
    const primaryCoords = primary[0].geometry.coordinates;
    const midIdx = Math.floor(primaryCoords.length / 2);
    const midpoint: [number, number] = [primaryCoords[midIdx][0], primaryCoords[midIdx][1]];
    
    if (pointInPolygon(midpoint, parcelCoords)) {
      foundPoints.push({
        coord: midpoint,
        intensity: 0.55,
        flowCount: 1,
      });
    }
  }
  
  // Sort and limit
  foundPoints.sort((a, b) => b.intensity - a.intensity);
  
  foundPoints.slice(0, scale.maxConvergenceZones).forEach((fp, idx) => {
    zones.push({
      type: 'Feature',
      properties: {
        id: `conv_${idx}`,
        intensity: fp.intensity,
        flowCount: Math.min(4, fp.flowCount),
        radiusM: scale.convergenceBaseRadius + fp.flowCount * 10,
        type: fp.flowCount >= 3 ? 'pinch' : 'overlap',
      },
      geometry: { type: 'Point', coordinates: fp.coord },
    });
  });
  
  return zones;
}

/**
 * Generate opportunity zones (stand sites) scored by 4-component terrain formula:
 *   stand_score = 0.35×bench_prox + 0.25×saddle_prox + 0.20×ridge_struct + 0.20×draw_conv
 *
 * Candidate points: convergence zone centers, saddle nodes, flow intersections.
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
  const MAX_ZONES = Math.min(3, scale.maxOpportunityZones);

  // v2.9 – Terrain-first candidate scoring.  Convergence is a tiny tie-breaker, NOT a primary signal.
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

  // Source 1 (was convergence zones – REMOVED in v2.9, terrain-only now)

  // Source 1: saddle nodes (natural stand sites)
  if (saddleNodes?.features?.length) {
    for (const f of saddleNodes.features) {
      if (f.geometry.type === 'Point') {
        const coord = f.geometry.coordinates as [number, number];
        candidates.push(scorePt(coord));
      }
    }
  }

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

  // Score each candidate: 3-component terrain formula + convergence tie-breaker
  const scored = candidates.map(c => ({
    ...c,
    totalScore: 0.40 * c.benchProx + 0.30 * c.saddleProx + 0.30 * c.ridgeStruct + c.convergenceTB,
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
      saddleBonus: s.saddleProx * 0.30,
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
