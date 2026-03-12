/**
 * Geometry validation utilities for parcel boundaries
 * Ensures coordinates are valid GeoJSON in [lng, lat] order
 */

// Expected bounds for KS/MO region
const KS_MO_BOUNDS = {
  minLng: -102.1,
  maxLng: -89.0,
  minLat: 35.9,
  maxLat: 40.7,
};

export interface GeometryValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized?: number[][] | null; // Normalized outer ring
  bounds?: [[number, number], [number, number]]; // [[sw_lng, sw_lat], [ne_lng, ne_lat]]
  centroid?: [number, number]; // [lng, lat]
  area?: number; // In acres
}

/**
 * Validate a single coordinate pair [lng, lat]
 */
function validateCoordinate(coord: number[], index: number): { valid: boolean; error?: string } {
  if (!Array.isArray(coord) || coord.length < 2) {
    return { valid: false, error: `Coordinate ${index}: invalid format` };
  }
  
  const [lng, lat] = coord;
  
  if (typeof lng !== 'number' || typeof lat !== 'number' || isNaN(lng) || isNaN(lat)) {
    return { valid: false, error: `Coordinate ${index}: non-numeric values` };
  }
  
  // Check if coordinates appear swapped ([lat, lng] instead of [lng, lat])
  // Longitude should be negative for US, latitude should be positive
  if (lng > 0 && lng < 50 && lat < -80) {
    return { valid: false, error: `Coordinate ${index}: appears to be [lat, lng] instead of [lng, lat]` };
  }
  
  return { valid: true };
}

/**
 * Check if coordinates are within expected KS/MO bounds
 */
function isWithinBounds(coord: number[]): boolean {
  const [lng, lat] = coord;
  return (
    lng >= KS_MO_BOUNDS.minLng &&
    lng <= KS_MO_BOUNDS.maxLng &&
    lat >= KS_MO_BOUNDS.minLat &&
    lat <= KS_MO_BOUNDS.maxLat
  );
}

/**
 * Calculate polygon area using shoelace formula
 * Returns area in acres
 */
function calculatePolygonArea(ring: number[][]): number {
  if (!ring || ring.length < 3) return 0;
  
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    area += ring[i][0] * ring[j][1];
    area -= ring[j][0] * ring[i][1];
  }
  area = Math.abs(area) / 2;
  
  // Convert square degrees to acres
  const latMid = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  const lonKm = 111.32 * Math.cos(latMid * Math.PI / 180);
  const latKm = 111.32;
  const sqKm = area * lonKm * latKm;
  
  return sqKm * 247.105; // 1 sq km = 247.105 acres
}

/**
 * Calculate bounding box from coordinates
 */
function calculateBounds(coords: number[][]): [[number, number], [number, number]] {
  if (!coords?.length) return [[0, 0], [0, 0]];
  
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const c of coords) {
    if (c[0] < minLng) minLng = c[0];
    if (c[0] > maxLng) maxLng = c[0];
    if (c[1] < minLat) minLat = c[1];
    if (c[1] > maxLat) maxLat = c[1];
  }
  
  return [[minLng, minLat], [maxLng, maxLat]];
}

/**
 * Calculate centroid from coordinates
 */
function calculateCentroid(coords: number[][]): [number, number] {
  if (!coords?.length) return [0, 0];
  const sum = coords.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1]], [0, 0]);
  return [sum[0] / coords.length, sum[1] / coords.length];
}

/**
 * Ensure ring is closed (first coord === last coord)
 */
function closeRing(ring: number[][]): number[][] {
  if (!ring || ring.length < 3) return ring;
  
  const first = ring[0];
  const last = ring[ring.length - 1];
  
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...ring, first];
  }
  return ring;
}

/**
 * Normalize coordinates from Polygon or MultiPolygon to outer ring array
 * Returns the outer ring as number[][] in [lng, lat] format
 */
export function normalizeToOuterRing(
  coords: number[][][] | number[][][][],
  geometryType: 'Polygon' | 'MultiPolygon' | string
): number[][] | null {
  if (!coords || !coords.length) return null;
  
  if (geometryType === 'Polygon') {
    // Polygon: coords = [ring, ...holes]
    const ring = coords[0] as number[][];
    if (!ring?.length || ring.length < 3) return null;
    return closeRing(ring);
  } else if (geometryType === 'MultiPolygon') {
    // MultiPolygon: coords = [[ring, ...holes], [ring, ...holes], ...]
    const polygons = coords as number[][][][];
    let largest: number[][] | null = null;
    let maxLen = 0;
    
    for (const poly of polygons) {
      const ring = poly[0];
      if (ring && ring.length > maxLen) {
        maxLen = ring.length;
        largest = ring;
      }
    }
    
    return largest ? closeRing(largest) : null;
  }
  
  // Try to infer from structure
  if (Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
    if (typeof coords[0][0][0] === 'number') {
      // Looks like Polygon
      return closeRing(coords[0] as number[][]);
    } else if (Array.isArray(coords[0][0][0])) {
      // Looks like MultiPolygon
      const polygons = coords as number[][][][];
      let largest: number[][] | null = null;
      let maxLen = 0;
      for (const poly of polygons) {
        const ring = poly[0];
        if (ring && ring.length > maxLen) {
          maxLen = ring.length;
          largest = ring;
        }
      }
      return largest ? closeRing(largest) : null;
    }
  }
  
  return null;
}

/**
 * Validate parcel geometry
 */
export function validateParcelGeometry(
  coords: number[][][] | number[][][][] | null,
  geometryType: 'Polygon' | 'MultiPolygon' | string
): GeometryValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (!coords) {
    return { valid: false, errors: ['No coordinates provided'], warnings };
  }
  
  // Normalize to outer ring
  const outerRing = normalizeToOuterRing(coords, geometryType);
  
  if (!outerRing) {
    return { valid: false, errors: ['Could not extract outer ring from geometry'], warnings };
  }
  
  if (outerRing.length < 4) {
    return { valid: false, errors: [`Ring has only ${outerRing.length} points (need at least 4)`], warnings };
  }
  
  // Validate each coordinate
  let outOfBoundsCount = 0;
  let swappedCoordsDetected = false;
  
  for (let i = 0; i < outerRing.length; i++) {
    const coordResult = validateCoordinate(outerRing[i], i);
    if (!coordResult.valid) {
      errors.push(coordResult.error!);
      
      // Check if this looks like a coordinate swap
      if (coordResult.error?.includes('[lat, lng]')) {
        swappedCoordsDetected = true;
      }
    }
    
    if (!isWithinBounds(outerRing[i])) {
      outOfBoundsCount++;
    }
  }
  
  if (swappedCoordsDetected) {
    errors.push('Coordinates appear to be in [lat, lng] order instead of [lng, lat]');
  }
  
  if (outOfBoundsCount > 0) {
    warnings.push(`${outOfBoundsCount} coordinates outside KS/MO bounds`);
  }
  
  if (outOfBoundsCount === outerRing.length) {
    errors.push('All coordinates are outside expected KS/MO bounds');
  }
  
  // Calculate metrics
  const area = calculatePolygonArea(outerRing);
  const bounds = calculateBounds(outerRing);
  const centroid = calculateCentroid(outerRing);
  
  if (area <= 0) {
    errors.push('Polygon has zero or negative area');
  } else if (area < 0.1) {
    warnings.push(`Very small parcel: ${area.toFixed(3)} acres`);
  } else if (area > 10000) {
    warnings.push(`Very large parcel: ${area.toFixed(0)} acres`);
  }
  
  // Check bounds sanity
  const bboxWidth = bounds[1][0] - bounds[0][0];
  const bboxHeight = bounds[1][1] - bounds[0][1];
  
  if (bboxWidth <= 0 || bboxHeight <= 0) {
    errors.push('Invalid bounding box dimensions');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalized: outerRing,
    bounds,
    centroid,
    area,
  };
}

/**
 * Quick validation check - returns true if geometry appears valid
 */
export function isValidParcelGeometry(
  coords: number[][][] | number[][][][] | null,
  geometryType: 'Polygon' | 'MultiPolygon' | string
): boolean {
  const result = validateParcelGeometry(coords, geometryType);
  return result.valid;
}

/**
 * Log detailed geometry debug info
 */
export function logGeometryDebug(
  label: string,
  coords: number[][][] | number[][][][] | null,
  geometryType: string
): void {
  console.log(`[GEOMETRY DEBUG] ${label}`);
  console.log(`  Type: ${geometryType}`);
  console.log(`  Raw coords structure: ${JSON.stringify(coords?.slice(0, 1)?.map(c => c?.slice?.(0, 2)))?.slice(0, 200)}...`);
  
  const result = validateParcelGeometry(coords, geometryType);
  console.log(`  Valid: ${result.valid}`);
  if (result.errors.length) console.log(`  Errors: ${result.errors.join('; ')}`);
  if (result.warnings.length) console.log(`  Warnings: ${result.warnings.join('; ')}`);
  if (result.bounds) console.log(`  Bounds: ${JSON.stringify(result.bounds)}`);
  if (result.centroid) console.log(`  Centroid: ${JSON.stringify(result.centroid)}`);
  if (result.area) console.log(`  Area: ${result.area.toFixed(2)} acres`);
}

// ========== COMPREHENSIVE GEOMETRY TRACE ==========

export interface GeometryTraceStep {
  stage: string;
  timestamp: number;
  geometryType: string;
  coordCount: number;
  firstCoord: number[] | null;
  lastCoord: number[] | null;
  bounds: [[number, number], [number, number]] | null;
  centroid: [number, number] | null;
  area: number | null;
  isClosed: boolean;
  isValid: boolean;
  errors: string[];
  coordOrder: 'lng_lat' | 'lat_lng' | 'unknown';
  rawSample: string; // First few coords for inspection
}

export interface GeometryTrace {
  parcelId: string;
  steps: GeometryTraceStep[];
  mismatchDetected: boolean;
  mismatchDetails: string[];
}

/**
 * Detect coordinate order (lng,lat vs lat,lng)
 */
function detectCoordOrder(coords: number[][]): 'lng_lat' | 'lat_lng' | 'unknown' {
  if (!coords?.length) return 'unknown';
  const [a, b] = coords[0];
  
  // For US coordinates: lng is negative (~-70 to -130), lat is positive (~25 to 50)
  if (a < 0 && a > -140 && b > 20 && b < 55) {
    return 'lng_lat'; // Correct GeoJSON order
  }
  if (b < 0 && b > -140 && a > 20 && a < 55) {
    return 'lat_lng'; // Swapped order (common mistake)
  }
  return 'unknown';
}

/**
 * Check if a ring is closed
 */
function isRingClosed(coords: number[][]): boolean {
  if (!coords || coords.length < 2) return false;
  const first = coords[0];
  const last = coords[coords.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

/**
 * Create a trace step from raw coordinates
 */
export function createTraceStep(
  stage: string,
  coords: number[][] | number[][][] | number[][][][] | null,
  geometryType: string
): GeometryTraceStep {
  const now = Date.now();
  
  if (!coords) {
    return {
      stage,
      timestamp: now,
      geometryType,
      coordCount: 0,
      firstCoord: null,
      lastCoord: null,
      bounds: null,
      centroid: null,
      area: null,
      isClosed: false,
      isValid: false,
      errors: ['No coordinates provided'],
      coordOrder: 'unknown',
      rawSample: 'null',
    };
  }
  
  // Normalize to outer ring for analysis
  let outerRing: number[][] | null = null;
  
  if (geometryType === 'Polygon' || geometryType === 'ring') {
    // coords is number[][][] for Polygon or number[][] for direct ring
    if (Array.isArray(coords[0]) && typeof coords[0][0] === 'number') {
      outerRing = coords as number[][];
    } else if (Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
      outerRing = (coords as number[][][])[0];
    }
  } else if (geometryType === 'MultiPolygon') {
    // coords is number[][][][]
    const polygons = coords as number[][][][];
    let largest: number[][] | null = null;
    let maxLen = 0;
    for (const poly of polygons) {
      if (poly[0] && poly[0].length > maxLen) {
        maxLen = poly[0].length;
        largest = poly[0];
      }
    }
    outerRing = largest;
  }
  
  if (!outerRing || outerRing.length < 3) {
    return {
      stage,
      timestamp: now,
      geometryType,
      coordCount: outerRing?.length || 0,
      firstCoord: outerRing?.[0] || null,
      lastCoord: outerRing?.[outerRing?.length - 1] || null,
      bounds: null,
      centroid: null,
      area: null,
      isClosed: false,
      isValid: false,
      errors: ['Could not extract valid ring'],
      coordOrder: 'unknown',
      rawSample: JSON.stringify(coords).slice(0, 200),
    };
  }
  
  const validation = validateParcelGeometry(
    geometryType === 'ring' ? [outerRing] as number[][][] : coords as number[][][] | number[][][][],
    geometryType === 'ring' ? 'Polygon' : geometryType
  );
  
  return {
    stage,
    timestamp: now,
    geometryType,
    coordCount: outerRing.length,
    firstCoord: outerRing[0],
    lastCoord: outerRing[outerRing.length - 1],
    bounds: validation.bounds || calculateBounds(outerRing),
    centroid: validation.centroid || calculateCentroid(outerRing),
    area: validation.area || calculatePolygonArea(outerRing),
    isClosed: isRingClosed(outerRing),
    isValid: validation.valid,
    errors: validation.errors,
    coordOrder: detectCoordOrder(outerRing),
    rawSample: JSON.stringify(outerRing.slice(0, 3)).slice(0, 300),
  };
}

/**
 * Compare two trace steps to detect mismatches
 */
export function compareTraceSteps(a: GeometryTraceStep, b: GeometryTraceStep): string[] {
  const issues: string[] = [];
  
  // Check coordinate counts
  if (a.coordCount !== b.coordCount) {
    issues.push(`Coord count mismatch: ${a.stage}=${a.coordCount} vs ${b.stage}=${b.coordCount}`);
  }
  
  // Check first coordinate
  if (a.firstCoord && b.firstCoord) {
    const lngDiff = Math.abs(a.firstCoord[0] - b.firstCoord[0]);
    const latDiff = Math.abs(a.firstCoord[1] - b.firstCoord[1]);
    if (lngDiff > 0.00001 || latDiff > 0.00001) {
      issues.push(`First coord mismatch: ${a.stage}=[${a.firstCoord}] vs ${b.stage}=[${b.firstCoord}]`);
    }
  }
  
  // Check bounds
  if (a.bounds && b.bounds) {
    const swLngDiff = Math.abs(a.bounds[0][0] - b.bounds[0][0]);
    const swLatDiff = Math.abs(a.bounds[0][1] - b.bounds[0][1]);
    const neLngDiff = Math.abs(a.bounds[1][0] - b.bounds[1][0]);
    const neLatDiff = Math.abs(a.bounds[1][1] - b.bounds[1][1]);
    
    if (swLngDiff > 0.0001 || swLatDiff > 0.0001 || neLngDiff > 0.0001 || neLatDiff > 0.0001) {
      issues.push(`Bounds mismatch: ${a.stage}=${JSON.stringify(a.bounds)} vs ${b.stage}=${JSON.stringify(b.bounds)}`);
    }
  }
  
  // Check coordinate order
  if (a.coordOrder !== b.coordOrder) {
    issues.push(`Coord order mismatch: ${a.stage}=${a.coordOrder} vs ${b.stage}=${b.coordOrder}`);
  }
  
  // Check validity
  if (a.isValid !== b.isValid) {
    issues.push(`Validity mismatch: ${a.stage}=${a.isValid} vs ${b.stage}=${b.isValid}`);
  }
  
  return issues;
}

/**
 * Create a full geometry trace
 */
export function createGeometryTrace(parcelId: string): GeometryTrace {
  return {
    parcelId,
    steps: [],
    mismatchDetected: false,
    mismatchDetails: [],
  };
}

/**
 * Add a step to a trace and check for mismatches
 */
export function addTraceStep(trace: GeometryTrace, step: GeometryTraceStep): void {
  trace.steps.push(step);
  
  // Compare with previous step if exists
  if (trace.steps.length > 1) {
    const prev = trace.steps[trace.steps.length - 2];
    const issues = compareTraceSteps(prev, step);
    if (issues.length > 0) {
      trace.mismatchDetected = true;
      trace.mismatchDetails.push(...issues);
    }
  }
}

/**
 * Print full trace to console
 */
export function printGeometryTrace(trace: GeometryTrace): void {
  console.log('\n========== GEOMETRY TRACE: ' + trace.parcelId + ' ==========');
  
  for (const step of trace.steps) {
    console.log(`\n[${step.stage}]`);
    console.log(`  Type: ${step.geometryType}`);
    console.log(`  Coord count: ${step.coordCount}`);
    console.log(`  First coord: ${JSON.stringify(step.firstCoord)}`);
    console.log(`  Last coord: ${JSON.stringify(step.lastCoord)}`);
    console.log(`  Closed: ${step.isClosed}`);
    console.log(`  Coord order: ${step.coordOrder}`);
    console.log(`  Bounds: ${JSON.stringify(step.bounds)}`);
    console.log(`  Centroid: ${JSON.stringify(step.centroid)}`);
    console.log(`  Area: ${step.area?.toFixed(2)} ac`);
    console.log(`  Valid: ${step.isValid}`);
    if (step.errors.length) console.log(`  Errors: ${step.errors.join('; ')}`);
    console.log(`  Sample: ${step.rawSample}`);
  }
  
  if (trace.mismatchDetected) {
    console.log('\n⚠️ MISMATCHES DETECTED:');
    trace.mismatchDetails.forEach(d => console.log(`  - ${d}`));
  } else {
    console.log('\n✅ No mismatches detected between stages');
  }
  
  console.log('========== END TRACE ==========\n');
}

/**
 * Validate that geometry is ready for terrain analysis
 */
export function validateForAnalysis(coords: number[][] | null): {
  valid: boolean;
  error: string | null;
} {
  if (!coords || coords.length < 4) {
    return { valid: false, error: 'Parcel has insufficient coordinates (need at least 4)' };
  }
  
  const order = detectCoordOrder(coords);
  if (order === 'lat_lng') {
    return { valid: false, error: 'Coordinates appear to be in [lat, lng] order instead of [lng, lat]' };
  }
  
  // Check bounds sanity
  const bounds = calculateBounds(coords);
  const width = bounds[1][0] - bounds[0][0];
  const height = bounds[1][1] - bounds[0][1];
  
  if (width <= 0 || height <= 0) {
    return { valid: false, error: 'Parcel has invalid bounding box (zero or negative dimensions)' };
  }
  
  if (width > 1 || height > 1) {
    return { valid: false, error: 'Parcel bounds are too large (>1 degree), likely corrupted coordinates' };
  }
  
  // Check area
  const area = calculatePolygonArea(coords);
  if (area < 0.5) {
    return { valid: false, error: `Parcel too small for analysis (${area.toFixed(2)} acres)` };
  }
  
  if (area > 5000) {
    return { valid: false, error: `Parcel too large for analysis (${area.toFixed(0)} acres)` };
  }
  
  return { valid: true, error: null };
}
