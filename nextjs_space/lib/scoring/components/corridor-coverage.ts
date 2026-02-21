/**
 * Corridor Coverage Component (V1)
 * 
 * Calculates % of parcel area within a fixed 50m buffer of terrain-derived corridor lines.
 * Uses deterministic grid-sampling for coverage calculation.
 * 
 * Method:
 * 1. Extract corridor LineStrings from funnels layer
 * 2. Create sampling grid within parcel bounds
 * 3. Count points within 50m of any corridor
 * 4. Coverage = points_near_corridor / total_points_in_parcel
 * 
 * Normalization: raw 0-100%, normalized01 = coverage_pct / 100
 */

import type { ComponentInput, ComponentResult, ComponentStatus } from './types';
import type { FunnelProperties } from '@/types/terrain';

// === Constants (versioned) ===
const BUFFER_METERS = 50;           // Fixed buffer distance
const GRID_SPACING_METERS = 10;     // Sampling grid resolution
const MIN_GRID_POINTS = 100;        // Minimum points for reliable sampling
const MAX_GRID_POINTS = 10000;      // Cap for performance

// === Confidence Levels ===
const CONFIDENCE_REAL = 0.90;       // Real corridor data from DEM flow accumulation
const CONFIDENCE_ESTIMATED = 0.55;  // Estimated from draw network proxy

// Cap for estimated data
const ESTIMATED_NORMALIZED_CAP = 0.75;

/**
 * Calculate corridor coverage score
 */
export function calculateCorridorCoverage(input: ComponentInput): ComponentResult {
  const { layers, parcelAcres, centroid, parcelGeometry } = input;
  const funnels = layers.funnels.features;
  
  // Extract corridors from funnels
  const corridors = funnels.filter(f => {
    const props = f.properties as FunnelProperties;
    return props.funnelType === 'corridor';
  });
  
  // Also include draws as secondary corridors (deer use draw bottoms)
  const draws = funnels.filter(f => {
    const props = f.properties as FunnelProperties;
    return props.funnelType === 'draw';
  });
  
  // Combine corridor features (corridors weighted higher, draws as backup)
  const allCorridorFeatures = [...corridors, ...draws];
  
  let coveragePct: number;
  let status: ComponentStatus;
  let confidence: number;
  let inputsUsed: string[];
  let notes: string;
  let corridorCount = corridors.length;
  let drawCount = draws.length;
  
  if (allCorridorFeatures.length === 0) {
    // No corridors detected
    coveragePct = 0;
    status = 'estimated';
    confidence = 0.40;
    inputsUsed = ['terrain_funnels'];
    notes = 'No corridors detected in terrain analysis';
  } else {
    // Calculate coverage using grid sampling
    const coverageResult = calculateCoverageGridSampling(
      allCorridorFeatures,
      parcelAcres,
      centroid,
      parcelGeometry
    );
    
    coveragePct = coverageResult.coveragePct;
    
    // Determine status based on data source
    if (corridors.length > 0) {
      // Real corridors from flow accumulation
      status = 'real';
      confidence = CONFIDENCE_REAL;
      inputsUsed = ['dem_flow_accumulation', 'corridor_features', 'parcel_boundary'];
      notes = `${corridors.length} main corridor${corridors.length !== 1 ? 's' : ''}`;
      if (draws.length > 0) {
        notes += `, ${draws.length} draw${draws.length !== 1 ? 's' : ''}`;
      }
    } else {
      // Only draws available (proxy for corridors)
      status = 'estimated';
      confidence = CONFIDENCE_ESTIMATED;
      inputsUsed = ['terrain_draws', 'parcel_boundary'];
      notes = `Estimated from ${draws.length} terrain draw${draws.length !== 1 ? 's' : ''} (corridor proxy)`;
      
      // Cap estimated coverage
      if (coveragePct / 100 > ESTIMATED_NORMALIZED_CAP) {
        coveragePct = ESTIMATED_NORMALIZED_CAP * 100;
        notes += ` [capped at ${Math.round(ESTIMATED_NORMALIZED_CAP * 100)}%]`;
      }
    }
    
    notes += `, buffer ${BUFFER_METERS}m`;
    notes += `, ${coverageResult.gridPointsUsed} sample points`;
  }
  
  // Clamp to valid range
  coveragePct = Math.max(0, Math.min(100, coveragePct));
  
  // Normalize to 0-1
  const normalized = coveragePct / 100;
  
  // Quality label
  const qualityLabel = getQualityLabel(normalized);
  const fullNotes = `${qualityLabel}: ${coveragePct.toFixed(1)}% coverage. ${notes}.`;
  
  return {
    componentId: 'corridor_coverage',
    raw: Math.round(coveragePct * 10) / 10,
    normalized: Math.round(normalized * 10000) / 10000,
    unit: 'percent',
    notes: fullNotes,
    status,
    confidence,
    inputsUsed,
    metadata: {
      corridorCount,
      drawCount,
      bufferMeters: BUFFER_METERS,
      gridSpacingMeters: GRID_SPACING_METERS,
      parcelAcres,
      hasParcelGeometry: !!parcelGeometry
    }
  };
}

/**
 * Grid sampling result
 */
interface CoverageResult {
  coveragePct: number;
  gridPointsUsed: number;
  pointsInBuffer: number;
}

/**
 * Calculate coverage using deterministic grid sampling
 */
function calculateCoverageGridSampling(
  corridorFeatures: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties>[],
  parcelAcres: number,
  centroid: [number, number],
  parcelGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon
): CoverageResult {
  // Get parcel bounds
  const bounds = parcelGeometry 
    ? getGeometryBounds(parcelGeometry)
    : estimateBoundsFromAcreage(centroid, parcelAcres);
  
  // Extract corridor line coordinates
  const corridorLines = extractCorridorLines(corridorFeatures);
  
  if (corridorLines.length === 0) {
    return { coveragePct: 0, gridPointsUsed: 0, pointsInBuffer: 0 };
  }
  
  // Generate sampling grid
  const gridPoints = generateSamplingGrid(bounds, parcelAcres, centroid, parcelGeometry);
  
  if (gridPoints.length === 0) {
    return { coveragePct: 0, gridPointsUsed: 0, pointsInBuffer: 0 };
  }
  
  // Count points within buffer of any corridor
  let pointsInBuffer = 0;
  
  for (const point of gridPoints) {
    const distToNearest = minDistanceToCorridors(point, corridorLines);
    if (distToNearest <= BUFFER_METERS) {
      pointsInBuffer++;
    }
  }
  
  const coveragePct = (pointsInBuffer / gridPoints.length) * 100;
  
  return {
    coveragePct,
    gridPointsUsed: gridPoints.length,
    pointsInBuffer
  };
}

/**
 * Extract line coordinates from corridor features
 */
function extractCorridorLines(
  features: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties>[]
): number[][][] {
  const lines: number[][][] = [];
  
  for (const feature of features) {
    if (feature.geometry.type === 'LineString') {
      lines.push(feature.geometry.coordinates);
    } else if (feature.geometry.type === 'Polygon') {
      // For polygons (draws), use the exterior ring as a line
      // Or extract centerline approximation
      const ring = feature.geometry.coordinates[0];
      if (ring.length >= 2) {
        lines.push(ring);
      }
    }
  }
  
  return lines;
}

/**
 * Generate deterministic sampling grid within parcel
 */
function generateSamplingGrid(
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  parcelAcres: number,
  centroid: [number, number],
  parcelGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon
): [number, number][] {
  const [centLng, centLat] = centroid;
  
  // Convert grid spacing to degrees (approximate)
  const metersPerDegLat = 111000;
  const metersPerDegLng = 111000 * Math.cos(centLat * Math.PI / 180);
  
  const latStep = GRID_SPACING_METERS / metersPerDegLat;
  const lngStep = GRID_SPACING_METERS / metersPerDegLng;
  
  const points: [number, number][] = [];
  
  // Generate grid points
  for (let lat = bounds.minLat; lat <= bounds.maxLat; lat += latStep) {
    for (let lng = bounds.minLng; lng <= bounds.maxLng; lng += lngStep) {
      // Check if point is inside parcel
      if (parcelGeometry) {
        if (pointInPolygon([lng, lat], parcelGeometry)) {
          points.push([lng, lat]);
        }
      } else {
        // No geometry - use all points in bounds (square approximation)
        points.push([lng, lat]);
      }
      
      // Cap for performance
      if (points.length >= MAX_GRID_POINTS) {
        return points;
      }
    }
  }
  
  // If too few points, add more around centroid
  if (points.length < MIN_GRID_POINTS) {
    const finerLatStep = latStep / 2;
    const finerLngStep = lngStep / 2;
    
    for (let lat = bounds.minLat; lat <= bounds.maxLat; lat += finerLatStep) {
      for (let lng = bounds.minLng; lng <= bounds.maxLng; lng += finerLngStep) {
        if (!parcelGeometry || pointInPolygon([lng, lat], parcelGeometry)) {
          // Avoid duplicates
          if (!points.some(p => Math.abs(p[0] - lng) < 1e-8 && Math.abs(p[1] - lat) < 1e-8)) {
            points.push([lng, lat]);
          }
        }
        if (points.length >= MIN_GRID_POINTS) break;
      }
      if (points.length >= MIN_GRID_POINTS) break;
    }
  }
  
  return points;
}

/**
 * Minimum distance from point to any corridor line (meters)
 */
function minDistanceToCorridors(point: [number, number], corridorLines: number[][][]): number {
  let minDist = Infinity;
  
  for (const line of corridorLines) {
    for (let i = 0; i < line.length - 1; i++) {
      const segmentDist = distanceToSegment(point, line[i] as [number, number], line[i + 1] as [number, number]);
      minDist = Math.min(minDist, segmentDist);
    }
    // Also check distance to vertices
    for (const vertex of line) {
      const dist = haversineDistance(point[1], point[0], vertex[1], vertex[0]);
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
  
  // Vector from start to end
  const dx = x2 - x1;
  const dy = y2 - y1;
  
  // If segment is a point
  if (dx === 0 && dy === 0) {
    return haversineDistance(py, px, y1, x1);
  }
  
  // Project point onto line
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  
  // Closest point on segment
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  
  return haversineDistance(py, px, closestY, closestX);
}

/**
 * Haversine distance in meters
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius in meters
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
 * Estimate bounds from acreage (square approximation)
 */
function estimateBoundsFromAcreage(
  centroid: [number, number],
  parcelAcres: number
): { minLng: number; maxLng: number; minLat: number; maxLat: number } {
  const [centLng, centLat] = centroid;
  
  // Convert acres to square meters, then to side length
  const areaSqMeters = parcelAcres * 4046.86;
  const sideMeters = Math.sqrt(areaSqMeters);
  const halfSide = sideMeters / 2;
  
  // Convert to degrees
  const metersPerDegLat = 111000;
  const metersPerDegLng = 111000 * Math.cos(centLat * Math.PI / 180);
  
  const latOffset = halfSide / metersPerDegLat;
  const lngOffset = halfSide / metersPerDegLng;
  
  return {
    minLng: centLng - lngOffset,
    maxLng: centLng + lngOffset,
    minLat: centLat - latOffset,
    maxLat: centLat + latOffset
  };
}

/**
 * Point-in-polygon test (ray casting)
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

/**
 * Check if point is inside polygon rings
 */
function pointInRings(point: [number, number], rings: number[][][]): boolean {
  // Must be inside exterior ring
  if (!pointInRing(point, rings[0])) {
    return false;
  }
  // Must be outside all holes
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(point, rings[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Ray casting algorithm for point-in-ring
 */
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
 * Quality label based on coverage
 */
function getQualityLabel(normalized: number): string {
  if (normalized >= 0.60) return 'Excellent corridor network';
  if (normalized >= 0.45) return 'Strong corridor coverage';
  if (normalized >= 0.30) return 'Good corridor coverage';
  if (normalized >= 0.15) return 'Moderate corridor coverage';
  if (normalized > 0) return 'Limited corridor coverage';
  return 'No corridors detected';
}
