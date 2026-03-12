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
