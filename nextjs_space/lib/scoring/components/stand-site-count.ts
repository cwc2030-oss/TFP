/**
 * Stand Site Count Component (V1)
 * 
 * Parcel-level baseline metric: counts viable stand placement opportunities.
 * Uses deterministic grid-based candidate identification.
 * 
 * Method:
 * 1. Primary: Use stand points from geoprocessor if available
 * 2. Fallback: Estimate candidates from terrain suitability grid
 * 
 * Normalization: count / 20 (0-20 range, more than 20 caps at 1.0)
 * 
 * Criteria for viable stand (when estimating):
 * - Not inside bedding areas (respect sanctuary)
 * - Within reasonable distance of corridors/funnels (ambush potential)
 * - Good TPI position (slight elevation advantage)
 */

import type { ComponentInput, ComponentResult, ComponentStatus } from './types';
import type { StandPointProperties, BeddingProperties, FunnelProperties } from '@/types/terrain';

// === Constants ===
const MAX_VIABLE_STANDS = 20;        // Normalization cap
const GRID_SPACING_METERS = 50;      // Candidate evaluation grid
const MIN_DIST_FROM_BEDDING_M = 80;  // Minimum distance from bedding
const MAX_DIST_TO_CORRIDOR_M = 200;  // Maximum distance to corridor/funnel
const MIN_STAND_SCORE = 60;          // Threshold for viable stand (0-100)

// === Confidence Levels ===
const CONFIDENCE_REAL = 0.90;        // Real stand data from geoprocessor
const CONFIDENCE_ESTIMATED = 0.55;   // Estimated from terrain grid

/**
 * Calculate stand site count score
 */
export function calculateStandSiteCount(input: ComponentInput): ComponentResult {
  const { layers, parcelAcres, centroid, parcelGeometry } = input;
  const geoprocessorStands = layers.standPoints.features;
  
  let viableCount: number;
  let status: ComponentStatus;
  let confidence: number;
  let inputsUsed: string[];
  let notes: string;
  let metadata: Record<string, unknown> = {};
  
  if (geoprocessorStands.length > 0) {
    // Primary: Use geoprocessor stand points
    // Filter by minimum score threshold
    const viableStands = geoprocessorStands.filter(stand => {
      const props = stand.properties as StandPointProperties;
      return props.score >= MIN_STAND_SCORE;
    });
    
    viableCount = viableStands.length;
    status = 'real';
    confidence = CONFIDENCE_REAL;
    inputsUsed = ['dem_terrain_analysis', 'stand_points', 'tpi_analysis'];
    
    // Calculate average score of viable stands
    const avgScore = viableStands.length > 0
      ? viableStands.reduce((sum, s) => sum + (s.properties as StandPointProperties).score, 0) / viableStands.length
      : 0;
    
    notes = `${viableCount} viable stand sites (score ≥${MIN_STAND_SCORE})`;
    if (geoprocessorStands.length > viableCount) {
      notes += `, ${geoprocessorStands.length - viableCount} marginal excluded`;
    }
    
    metadata = {
      totalStandsFromGeoprocessor: geoprocessorStands.length,
      viableStands: viableCount,
      avgViableScore: Math.round(avgScore),
      scoreThreshold: MIN_STAND_SCORE,
      method: 'geoprocessor_filter'
    };
  } else {
    // Fallback: Estimate from terrain grid sampling
    const estimated = estimateStandCandidates(input);
    viableCount = estimated.count;
    status = 'estimated';
    confidence = CONFIDENCE_ESTIMATED;
    inputsUsed = ['terrain_funnels', 'bedding_polygons', 'parcel_boundary'];
    notes = `Estimated ${viableCount} viable candidates from terrain grid (${estimated.gridPointsEvaluated} points sampled)`;
    metadata = {
      ...estimated,
      method: 'terrain_grid_estimation'
    };
  }
  
  // Clamp to range
  const clampedCount = Math.min(MAX_VIABLE_STANDS, Math.max(0, viableCount));
  
  // Normalize: count / 20
  const normalized = clampedCount / MAX_VIABLE_STANDS;
  
  // Quality label
  const qualityLabel = getQualityLabel(clampedCount);
  const fullNotes = `${qualityLabel}. ${notes}.`;
  
  return {
    componentId: 'stand_site_count',
    raw: clampedCount,
    normalized: Math.round(normalized * 10000) / 10000,
    unit: 'count',
    notes: fullNotes,
    status,
    confidence,
    inputsUsed,
    metadata
  };
}

/**
 * Estimation result
 */
interface EstimationResult {
  count: number;
  gridPointsEvaluated: number;
  candidateScores: number[];
}

/**
 * Estimate stand candidates from terrain grid sampling
 */
function estimateStandCandidates(input: ComponentInput): EstimationResult {
  const { layers, parcelAcres, centroid, parcelGeometry } = input;
  const bedding = layers.beddingPolygons.features;
  const funnels = layers.funnels.features;
  
  // Get parcel bounds
  const bounds = parcelGeometry 
    ? getGeometryBounds(parcelGeometry)
    : estimateBoundsFromAcreage(centroid, parcelAcres);
  
  // Generate evaluation grid
  const gridPoints = generateEvaluationGrid(bounds, centroid, parcelAcres, parcelGeometry);
  
  // Extract funnel/corridor coordinates for distance calculations
  const funnelCoords = extractFunnelCoordinates(funnels);
  const beddingPolygons = bedding.map(b => b.geometry.coordinates[0]);
  
  // Evaluate each grid point
  const candidateScores: number[] = [];
  
  for (const point of gridPoints) {
    const score = evaluateStandCandidate(point, funnelCoords, beddingPolygons);
    if (score >= MIN_STAND_SCORE) {
      candidateScores.push(score);
    }
  }
  
  // Sort by score descending and take top N
  candidateScores.sort((a, b) => b - a);
  const topCandidates = candidateScores.slice(0, MAX_VIABLE_STANDS);
  
  return {
    count: topCandidates.length,
    gridPointsEvaluated: gridPoints.length,
    candidateScores: topCandidates
  };
}

/**
 * Evaluate a potential stand location
 * Returns score 0-100 based on terrain suitability
 */
function evaluateStandCandidate(
  point: [number, number],
  funnelCoords: number[][][],
  beddingPolygons: number[][][]
): number {
  let score = 50; // Base score
  
  // Check distance to bedding (must be far enough away)
  const distToBedding = minDistanceToPolygons(point, beddingPolygons);
  if (distToBedding < MIN_DIST_FROM_BEDDING_M) {
    // Too close to bedding - not viable
    return 0;
  }
  // Bonus for being at ideal distance (100-150m)
  if (distToBedding >= 100 && distToBedding <= 150) {
    score += 20;
  } else if (distToBedding < 200) {
    score += 10;
  }
  
  // Check distance to corridors/funnels (must be close enough)
  const distToCorridor = minDistanceToLines(point, funnelCoords);
  if (distToCorridor > MAX_DIST_TO_CORRIDOR_M) {
    // Too far from corridors - reduced viability
    score -= 30;
  } else if (distToCorridor <= 50) {
    // Excellent ambush position
    score += 25;
  } else if (distToCorridor <= 100) {
    score += 15;
  } else {
    score += 5;
  }
  
  // Clamp to 0-100
  return Math.max(0, Math.min(100, score));
}

/**
 * Generate evaluation grid within parcel
 */
function generateEvaluationGrid(
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  centroid: [number, number],
  parcelAcres: number,
  parcelGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon
): [number, number][] {
  const [centLng, centLat] = centroid;
  
  // Convert grid spacing to degrees
  const metersPerDegLat = 111000;
  const metersPerDegLng = 111000 * Math.cos(centLat * Math.PI / 180);
  
  const latStep = GRID_SPACING_METERS / metersPerDegLat;
  const lngStep = GRID_SPACING_METERS / metersPerDegLng;
  
  const points: [number, number][] = [];
  const maxPoints = 500; // Cap for performance
  
  for (let lat = bounds.minLat; lat <= bounds.maxLat; lat += latStep) {
    for (let lng = bounds.minLng; lng <= bounds.maxLng; lng += lngStep) {
      if (!parcelGeometry || pointInPolygon([lng, lat], parcelGeometry)) {
        points.push([lng, lat]);
      }
      if (points.length >= maxPoints) break;
    }
    if (points.length >= maxPoints) break;
  }
  
  return points;
}

/**
 * Extract line coordinates from funnel features
 */
function extractFunnelCoordinates(
  funnels: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties>[]
): number[][][] {
  const lines: number[][][] = [];
  
  for (const funnel of funnels) {
    if (funnel.geometry.type === 'LineString') {
      lines.push(funnel.geometry.coordinates);
    } else if (funnel.geometry.type === 'Polygon') {
      // Use exterior ring
      lines.push(funnel.geometry.coordinates[0]);
    }
  }
  
  return lines;
}

/**
 * Minimum distance from point to any polygon (meters)
 */
function minDistanceToPolygons(point: [number, number], polygons: number[][][]): number {
  if (polygons.length === 0) return Infinity;
  
  let minDist = Infinity;
  for (const ring of polygons) {
    // Check if inside polygon (distance = 0)
    if (pointInRing(point, ring)) {
      return 0;
    }
    // Otherwise find distance to nearest edge
    for (let i = 0; i < ring.length - 1; i++) {
      const dist = distanceToSegment(point, ring[i] as [number, number], ring[i + 1] as [number, number]);
      minDist = Math.min(minDist, dist);
    }
  }
  return minDist;
}

/**
 * Minimum distance from point to any line (meters)
 */
function minDistanceToLines(point: [number, number], lines: number[][][]): number {
  if (lines.length === 0) return Infinity;
  
  let minDist = Infinity;
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const dist = distanceToSegment(point, line[i] as [number, number], line[i + 1] as [number, number]);
      minDist = Math.min(minDist, dist);
    }
  }
  return minDist;
}

/**
 * Distance from point to line segment (meters)
 */
function distanceToSegment(
  point: [number, number],
  segStart: [number, number],
  segEnd: [number, number]
): number {
  const [px, py] = point;
  const [x1, y1] = segStart;
  const [x2, y2] = segEnd;
  
  const dx = x2 - x1;
  const dy = y2 - y1;
  
  if (dx === 0 && dy === 0) {
    return haversineDistance(py, px, y1, x1);
  }
  
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  
  return haversineDistance(py, px, closestY, closestX);
}

/**
 * Haversine distance in meters
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Get bounds from GeoJSON geometry
 */
function getGeometryBounds(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): {
  minLng: number; maxLng: number; minLat: number; maxLat: number;
} {
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  
  const rings = geometry.type === 'Polygon' 
    ? geometry.coordinates 
    : geometry.coordinates.flat();
  
  for (const ring of rings) {
    for (const coord of ring) {
      const [lng, lat] = coord;
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }
  
  return { minLng, maxLng, minLat, maxLat };
}

/**
 * Estimate bounds from acreage
 */
function estimateBoundsFromAcreage(
  centroid: [number, number],
  parcelAcres: number
): { minLng: number; maxLng: number; minLat: number; maxLat: number } {
  const [centLng, centLat] = centroid;
  const areaSqMeters = parcelAcres * 4046.86;
  const sideMeters = Math.sqrt(areaSqMeters);
  const halfSide = sideMeters / 2;
  
  const metersPerDegLat = 111000;
  const metersPerDegLng = 111000 * Math.cos(centLat * Math.PI / 180);
  
  return {
    minLng: centLng - halfSide / metersPerDegLng,
    maxLng: centLng + halfSide / metersPerDegLng,
    minLat: centLat - halfSide / metersPerDegLat,
    maxLat: centLat + halfSide / metersPerDegLat
  };
}

/**
 * Point-in-polygon test
 */
function pointInPolygon(
  point: [number, number],
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): boolean {
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(polygon => 
      pointInRings(point, polygon)
    );
  }
  return pointInRings(point, geometry.coordinates);
}

function pointInRings(point: [number, number], rings: number[][][]): boolean {
  if (!pointInRing(point, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(point, rings[i])) return false;
  }
  return true;
}

function pointInRing(point: [number, number], ring: number[][]): boolean {
  const [x, y] = point;
  let inside = false;
  
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

/**
 * Quality label based on count
 */
function getQualityLabel(count: number): string {
  if (count >= 15) return 'Excellent stand site options';
  if (count >= 10) return 'Strong stand site availability';
  if (count >= 6) return 'Good stand site selection';
  if (count >= 3) return 'Adequate stand sites';
  if (count >= 1) return 'Limited stand options';
  return 'No viable stand sites identified';
}
