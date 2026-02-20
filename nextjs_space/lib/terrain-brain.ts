// Terra Firma Terrain Brain Client
// Connects to external geoprocessor or falls back to preview mode
// NOTE: Real API calls happen server-side only via /api/terrain-analysis

import * as turf from '@turf/turf';
import type {
  TerrainAnalysisRequest,
  TerrainAnalysisResponse,
  TerrainAnalysisError,
  TerrainLayers,
  TerrainSummary,
  TerrainProvenance,
  SeasonProfile,
  WindDirection,
  BeddingProperties,
  FunnelProperties,
  StandPointProperties,
} from '@/types/terrain';

// Server-side only - not exposed to browser
const GEOPROCESSOR_URL = process.env.GEOPROCESSOR_API_URL;
const API_TIMEOUT_MS = 90000; // 90 seconds for real DEM processing

// ============ Main API Client ============

export async function analyzeTerrainReal(
  parcel: GeoJSON.Feature<GeoJSON.Polygon>,
  options?: {
    bufferMeters?: number;
    seasonProfile?: SeasonProfile;
    prevailingWinds?: WindDirection[];
  }
): Promise<TerrainAnalysisResponse> {
  if (!GEOPROCESSOR_URL) {
    throw createError('SERVICE_UNAVAILABLE', 'Terrain Brain service not configured', true);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(`${GEOPROCESSOR_URL}/v1/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parcel,
        bufferMeters: options?.bufferMeters ?? 800,
        seasonProfile: options?.seasonProfile ?? 'rut',
        prevailingWinds: options?.prevailingWinds ?? ['NW'],
      } satisfies TerrainAnalysisRequest),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw createError(
        errorData.code || 'INTERNAL_ERROR',
        errorData.message || `Terrain analysis failed: ${response.status}`,
        true
      );
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      throw createError('PROCESSING_TIMEOUT', 'Terrain analysis timed out', true);
    }
    
    if ((error as TerrainAnalysisError).code) {
      throw error;
    }
    
    throw createError('SERVICE_UNAVAILABLE', 'Unable to connect to Terrain Brain service', true);
  }
}

// ============ Preview Mode (Client-side Heuristics) ============

// ============ Final Validation: Ensure all features are inside parcel ============
// Uses Turf.js for robust geometry operations on concave/complex parcels

function validateAndClipFeatures(
  layers: TerrainLayers,
  parcelGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): TerrainLayers {
  // Create Turf polygon/multipolygon for validation
  const parcelFeature = turf.feature(parcelGeometry);
  
  // Validate bedding polygons - clip to parcel boundary
  const validBedding = layers.beddingPolygons.features
    .map(f => {
      try {
        const clipped = turf.intersect(turf.featureCollection([
          turf.feature(f.geometry),
          parcelFeature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
        ]));
        if (clipped && (clipped.geometry.type === 'Polygon' || clipped.geometry.type === 'MultiPolygon')) {
          // Return clipped geometry with original properties
          if (clipped.geometry.type === 'MultiPolygon') {
            // Take largest polygon from MultiPolygon result
            const coords = clipped.geometry.coordinates;
            let largestIdx = 0;
            let largestArea = 0;
            coords.forEach((poly, idx) => {
              const area = turf.area(turf.polygon(poly as number[][][]));
              if (area > largestArea) {
                largestArea = area;
                largestIdx = idx;
              }
            });
            return {
              ...f,
              geometry: { type: 'Polygon' as const, coordinates: coords[largestIdx] as number[][][] }
            };
          }
          return { ...f, geometry: clipped.geometry as GeoJSON.Polygon };
        }
      } catch (e) {
        // Intersection failed - check if centroid is inside
        try {
          const centroid = turf.centroid(turf.feature(f.geometry));
          if (pointInParcel(centroid.geometry.coordinates as [number, number], parcelGeometry)) {
            return f; // Keep original if centroid inside
          }
        } catch { /* skip */ }
      }
      return null;
    })
    .filter((f): f is GeoJSON.Feature<GeoJSON.Polygon, BeddingProperties> => f !== null);
  
  // Validate funnels - clip polygons and lines to parcel
  const validFunnels = layers.funnels.features
    .map(f => {
      try {
        if (f.geometry.type === 'Polygon') {
          const clipped = turf.intersect(turf.featureCollection([
            turf.feature(f.geometry),
            parcelFeature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
          ]));
          if (clipped && clipped.geometry.type === 'Polygon') {
            return { ...f, geometry: clipped.geometry as GeoJSON.Polygon };
          }
        } else if (f.geometry.type === 'LineString') {
          // Clip LineString to parcel
          const clipped = clipLineToParcel(f.geometry.coordinates, parcelGeometry);
          if (clipped.length >= 2) {
            return { ...f, geometry: { type: 'LineString' as const, coordinates: clipped } };
          }
        }
      } catch (e) {
        // Clipping failed - check if any point is inside
        const coords = f.geometry.type === 'Polygon' 
          ? f.geometry.coordinates[0] 
          : f.geometry.coordinates;
        if (coords.some(c => pointInParcel(c as [number, number], parcelGeometry))) {
          return f;
        }
      }
      return null;
    })
    .filter((f): f is GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties> => f !== null);
  
  // Validate stand points - must be strictly inside parcel
  const validStands = layers.standPoints.features.filter(f => {
    const coords = f.geometry.coordinates as [number, number];
    return pointInParcel(coords, parcelGeometry);
  });
  
  // Re-rank stands after filtering
  validStands.forEach((f, idx) => {
    if (f.properties) {
      f.properties.rank = idx + 1;
    }
  });
  
  console.log(`[TFP] Validation: bedding ${layers.beddingPolygons.features.length}→${validBedding.length}, ` +
    `funnels ${layers.funnels.features.length}→${validFunnels.length}, ` +
    `stands ${layers.standPoints.features.length}→${validStands.length}`);
  
  return {
    beddingPolygons: { type: 'FeatureCollection', features: validBedding },
    funnels: { type: 'FeatureCollection', features: validFunnels },
    standPoints: { type: 'FeatureCollection', features: validStands },
  };
}

export function generatePreviewAnalysis(
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  options?: {
    bufferMeters?: number;
    seasonProfile?: SeasonProfile;
    prevailingWinds?: WindDirection[];
  }
): TerrainAnalysisResponse {
  // Get the full parcel geometry for Turf.js operations (handles MultiPolygon correctly)
  const parcelGeometry = parcel.geometry;
  
  // Extract primary ring for centroid/bounds calculations (backward compat)
  const primaryRing = extractPrimaryRing(parcelGeometry);
  const center = calculateCentroid(primaryRing);
  const bounds = calculateBoundsFromGeometry(parcelGeometry); // Use full geometry for bounds
  const acreage = calculateAcreageFromGeometry(parcelGeometry); // Use Turf for accuracy
  const bufferMeters = options?.bufferMeters ?? 800;
  const prevailingWinds = options?.prevailingWinds ?? ['NW'];
  const seasonProfile = options?.seasonProfile ?? 'rut';
  
  const vertexCount = parcelGeometry.type === 'MultiPolygon'
    ? parcelGeometry.coordinates.reduce((sum, poly) => sum + poly[0].length, 0)
    : parcelGeometry.coordinates[0].length;
  
  console.log(`[TFP] Generating preview analysis for ${acreage.toFixed(1)} acre ${parcelGeometry.type} with ${vertexCount} vertices`);

  // Generate synthetic bedding areas (south-facing slopes) - constrained to parcel
  const beddingPolygons = generateSyntheticBedding(center, bounds, acreage, parcelGeometry);
  
  // Generate synthetic funnels (draws and saddles) - constrained to parcel
  const funnels = generateSyntheticFunnels(center, bounds, parcelGeometry);
  
  // Generate ranked stand points - constrained to parcel
  const standPoints = generateSyntheticStands(center, bounds, prevailingWinds, beddingPolygons, funnels, parcelGeometry);

  // FINAL VALIDATION: Ensure all features are clipped/filtered to parcel boundary (using Turf.js)
  const validatedLayers = validateAndClipFeatures(
    { beddingPolygons, funnels, standPoints },
    parcelGeometry
  );

  const layers: TerrainLayers = validatedLayers;

  const summary: TerrainSummary = {
    totalBeddingAcres: beddingPolygons.features.reduce((sum, f) => sum + (f.properties?.areaAcres || 0), 0),
    funnelCount: funnels.features.length,
    topStandScore: standPoints.features[0]?.properties?.score || 0,
    analysisAreaAcres: acreage + (bufferMeters * bufferMeters * Math.PI / 4046.86), // rough buffer area
    recommendedSeason: seasonProfile,
  };

  const provenance: TerrainProvenance = {
    demSource: 'MAPBOX_TERRAIN_RGB',
    demResolution: '~30m',
    landcoverSource: 'ESTIMATED',
    analysisTimestamp: new Date().toISOString(),
    isPreview: true,
  };

  return {
    mode: 'preview',
    layers,
    summary,
    provenance,
  };
}

// ============ Combined Analysis Function ============

export async function analyzeTerrainWithFallback(
  parcel: GeoJSON.Feature<GeoJSON.Polygon>,
  options?: {
    bufferMeters?: number;
    seasonProfile?: SeasonProfile;
    prevailingWinds?: WindDirection[];
    forcePreview?: boolean;
  }
): Promise<TerrainAnalysisResponse> {
  // If preview mode is forced, skip real API
  if (options?.forcePreview) {
    return generatePreviewAnalysis(parcel, options);
  }

  // Try real API first
  try {
    return await analyzeTerrainReal(parcel, options);
  } catch (error) {
    const terrainError = error as TerrainAnalysisError;
    
    // If fallback is allowed, use preview mode
    if (terrainError.fallbackToPreview) {
      console.warn('Terrain Brain unavailable, falling back to preview mode:', terrainError.message);
      return generatePreviewAnalysis(parcel, options);
    }
    
    throw error;
  }
}

// ============ Helper Functions ============

function createError(
  code: TerrainAnalysisError['code'],
  message: string,
  fallbackToPreview: boolean
): TerrainAnalysisError {
  return { code, message, fallbackToPreview };
}

function calculateCentroid(coords: number[][]): [number, number] {
  let sumLng = 0, sumLat = 0;
  const n = coords.length - 1; // exclude closing point
  for (let i = 0; i < n; i++) {
    sumLng += coords[i][0];
    sumLat += coords[i][1];
  }
  return [sumLng / n, sumLat / n];
}

function calculateBounds(coords: number[][]): { minLng: number; maxLng: number; minLat: number; maxLat: number } {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return { minLng, maxLng, minLat, maxLat };
}

// Calculate bounds from full Polygon/MultiPolygon geometry
function calculateBoundsFromGeometry(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): { minLng: number; maxLng: number; minLat: number; maxLat: number } {
  const bbox = turf.bbox(turf.feature(geometry));
  return {
    minLng: bbox[0],
    minLat: bbox[1],
    maxLng: bbox[2],
    maxLat: bbox[3]
  };
}

function calculateAcreage(coords: number[][]): number {
  // Shoelace formula for polygon area, converted to acres
  let area = 0;
  const n = coords.length - 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += coords[i][0] * coords[j][1];
    area -= coords[j][0] * coords[i][1];
  }
  area = Math.abs(area) / 2;
  // Convert degrees² to acres (very rough, assumes ~40° latitude)
  const metersPerDegLng = 85000;
  const metersPerDegLat = 111000;
  const sqMeters = area * metersPerDegLng * metersPerDegLat;
  return sqMeters / 4046.86;
}

// Calculate acreage from full Polygon/MultiPolygon using Turf.js for accuracy
function calculateAcreageFromGeometry(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
  try {
    const sqMeters = turf.area(turf.feature(geometry));
    return sqMeters / 4046.86; // Convert sq meters to acres
  } catch {
    // Fallback to primary ring calculation
    const primaryRing = extractPrimaryRing(geometry);
    return calculateAcreage(primaryRing);
  }
}

// ============ Geometry Helpers ============

// Extract the primary (largest) ring from Polygon or MultiPolygon
function extractPrimaryRing(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): number[][] {
  if (geometry.type === 'Polygon') {
    // Polygon: coordinates[0] is the outer ring
    return geometry.coordinates[0] as number[][];
  } else if (geometry.type === 'MultiPolygon') {
    // MultiPolygon: find the largest polygon by area
    let largestRing: number[][] = geometry.coordinates[0][0] as number[][];
    let largestArea = 0;
    
    for (const polygon of geometry.coordinates) {
      const ring = polygon[0] as number[][];
      const area = calculateRingArea(ring);
      if (area > largestArea) {
        largestArea = area;
        largestRing = ring;
      }
    }
    return largestRing;
  }
  // Fallback - shouldn't happen
  return [];
}

// Calculate rough area of a ring (for comparison only)
function calculateRingArea(ring: number[][]): number {
  let area = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += ring[i][0] * ring[j][1];
    area -= ring[j][0] * ring[i][1];
  }
  return Math.abs(area) / 2;
}

// ============ Seeded Random for Consistency ============

// Simple seeded random number generator
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

// Create seed from center coordinates for consistency
function createSeedFromCenter(center: [number, number]): number {
  return Math.abs(Math.floor(center[0] * 10000) + Math.floor(center[1] * 10000));
}

// ============ Point-in-Polygon Testing (Turf.js-based) ============

// Point-in-Polygon using Turf.js - handles Polygon and MultiPolygon correctly
function pointInParcel(point: [number, number], parcel: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  try {
    const pt = turf.point(point);
    const poly = turf.feature(parcel);
    return turf.booleanPointInPolygon(pt, poly as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>);
  } catch {
    return false;
  }
}

// Legacy point-in-polygon for simple coordinate arrays (backward compat)
function pointInPolygon(point: [number, number], polygon: number[][]): boolean {
  if (!polygon || polygon.length < 3) return false;
  
  const [x, y] = point;
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    
    // Guard against division by zero
    if (yj === yi) continue;
    
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    
    if (intersect) inside = !inside;
  }
  
  return inside;
}

// Generate a random point INSIDE the parcel (Polygon or MultiPolygon)
// Uses rejection sampling with hard maxAttempts limit
const MAX_POINT_ATTEMPTS = 100;

function generatePointInsideParcel(
  parcelGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  center: [number, number],
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  rand: () => number,
  maxAttempts = 50
): [number, number] {
  const attempts = Math.min(maxAttempts, MAX_POINT_ATTEMPTS);
  
  const lngSpan = bounds.maxLng - bounds.minLng;
  const latSpan = bounds.maxLat - bounds.minLat;
  
  if (lngSpan <= 0 || latSpan <= 0) {
    return center;
  }
  
  // Try random points within bounding box, keep if inside any component
  for (let attempt = 0; attempt < attempts; attempt++) {
    const point: [number, number] = [
      bounds.minLng + rand() * lngSpan,
      bounds.minLat + rand() * latSpan,
    ];
    
    if (pointInParcel(point, parcelGeometry)) {
      return point;
    }
  }
  
  // Fallback: try centroid of largest component
  try {
    const centroid = turf.centroid(turf.feature(parcelGeometry));
    const pt = centroid.geometry.coordinates as [number, number];
    if (pointInParcel(pt, parcelGeometry)) {
      return pt;
    }
  } catch { /* ignore */ }
  
  // Last resort: return provided center
  return center;
}

// ============ Polygon Clipping (Turf.js-based) ============

// Clip a polygon to parcel boundary using Turf.js intersect
function clipPolygonToParcel(
  subjectPolygon: number[][], 
  parcelGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): number[][] {
  try {
    // Create Turf features
    const subject = turf.polygon([subjectPolygon]);
    const clip = turf.feature(parcelGeometry);
    
    // Intersect using Turf
    const intersection = turf.intersect(turf.featureCollection([subject, clip as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>]));
    
    if (intersection) {
      if (intersection.geometry.type === 'Polygon') {
        return intersection.geometry.coordinates[0] as number[][];
      } else if (intersection.geometry.type === 'MultiPolygon') {
        // Return largest polygon from result
        const coords = intersection.geometry.coordinates;
        let largestIdx = 0;
        let largestArea = 0;
        coords.forEach((poly, idx) => {
          const area = turf.area(turf.polygon(poly as number[][][]));
          if (area > largestArea) {
            largestArea = area;
            largestIdx = idx;
          }
        });
        return coords[largestIdx][0] as number[][];
      }
    }
  } catch (e) {
    console.warn('[TFP] Polygon clip failed, using original:', e);
  }
  
  // Return original if clipping fails
  return subjectPolygon;
}

// Clip a LineString to stay within parcel using Turf.js
function clipLineToParcel(
  lineCoords: number[][], 
  parcelGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): number[][] {
  try {
    const line = turf.lineString(lineCoords);
    const poly = turf.feature(parcelGeometry);
    
    // Use lineSplit and filter segments inside
    const clipped = turf.booleanWithin(line, poly as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>)
      ? lineCoords 
      : getLineSegmentsInsidePolygon(lineCoords, parcelGeometry);
    
    return clipped.length >= 2 ? clipped : lineCoords;
  } catch {
    return lineCoords;
  }
}

// Get line segments that are inside the polygon
function getLineSegmentsInsidePolygon(
  lineCoords: number[][], 
  parcelGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): number[][] {
  const result: number[][] = [];
  
  for (let i = 0; i < lineCoords.length; i++) {
    const point = lineCoords[i] as [number, number];
    
    if (pointInParcel(point, parcelGeometry)) {
      result.push(point);
    } else if (result.length > 0 && i > 0) {
      // Find intersection with parcel boundary
      const prevPoint = lineCoords[i - 1] as [number, number];
      if (pointInParcel(prevPoint, parcelGeometry)) {
        const intersection = findBoundaryIntersection(prevPoint, point, parcelGeometry);
        if (intersection) result.push(intersection);
        break; // Stop at first exit
      }
    }
  }
  
  return result;
}

// Find where a line segment crosses the parcel boundary
function findBoundaryIntersection(
  inside: [number, number], 
  outside: [number, number], 
  parcelGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): number[] | null {
  try {
    const line = turf.lineString([inside, outside]);
    const poly = turf.feature(parcelGeometry);
    
    // Get polygon boundary as linestring(s)
    const boundary = turf.polygonToLine(poly as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>);
    
    // Find intersections
    const intersections = turf.lineIntersect(line, boundary);
    
    if (intersections.features.length > 0) {
      // Return closest intersection to inside point
      let closest = intersections.features[0].geometry.coordinates;
      let minDist = turf.distance(turf.point(inside), turf.point(closest as [number, number]));
      
      for (const feat of intersections.features) {
        const dist = turf.distance(turf.point(inside), feat);
        if (dist < minDist) {
          minDist = dist;
          closest = feat.geometry.coordinates;
        }
      }
      
      return closest as number[];
    }
  } catch { /* ignore */ }
  
  return null;
}

// ============ Synthetic Data Generators ============

function generateSyntheticBedding(
  center: [number, number],
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  acreage: number,
  parcelGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon
): GeoJSON.FeatureCollection<GeoJSON.Polygon, BeddingProperties> {
  const features: GeoJSON.Feature<GeoJSON.Polygon, BeddingProperties>[] = [];
  const lngSpan = bounds.maxLng - bounds.minLng;
  const latSpan = bounds.maxLat - bounds.minLat;
  
  // Use seeded random for consistency
  const rand = seededRandom(createSeedFromCenter(center) + 1);
  
  // Generate 2-4 bedding areas based on property size
  const numBedding = Math.min(4, Math.max(2, Math.floor(acreage / 50)));
  
  for (let i = 0; i < numBedding; i++) {
    // Generate center point INSIDE the parcel
    let beddingCenter: [number, number];
    if (parcelGeometry) {
      beddingCenter = generatePointInsideParcel(parcelGeometry, center, bounds, rand);
    } else {
      // Fallback: small offset from center
      beddingCenter = [
        center[0] + (rand() - 0.5) * lngSpan * 0.2,
        center[1] + (rand() - 0.5) * latSpan * 0.2,
      ];
    }
    
    // Create irregular polygon - size proportional to parcel (slightly larger to ensure coverage)
    const baseRadius = Math.min(lngSpan, latSpan) * 0.12;
    const radius = baseRadius * (0.6 + rand() * 0.6);
    let polygon = createIrregularPolygon(beddingCenter, radius, 8 + Math.floor(rand() * 4), rand);
    
    // CLIP polygon to parcel boundary using Turf.js (handles concave polygons)
    if (parcelGeometry) {
      polygon = clipPolygonToParcel(polygon, parcelGeometry);
      
      // Skip if clipped polygon is degenerate
      if (polygon.length < 4) continue;
    }
    
    const aspectDegrees = 135 + rand() * 90;
    const aspectLabels = ['S', 'SW', 'SE'];
    
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [polygon] },
      properties: {
        type: i === 0 ? 'thermal_bedding' : (rand() > 0.5 ? 'transition_bedding' : 'escape_cover'),
        slopeRange: [8 + rand() * 4, 18 + rand() * 7],
        aspect: aspectLabels[Math.floor(rand() * aspectLabels.length)],
        aspectDegrees,
        areaAcres: 0.5 + rand() * 3,
        confidence: 0.6 + rand() * 0.3,
      },
    });
  }
  
  return { type: 'FeatureCollection', features };
}

function generateSyntheticFunnels(
  center: [number, number],
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  parcelGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon
): GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties> {
  const features: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties>[] = [];
  const lngSpan = bounds.maxLng - bounds.minLng;
  const latSpan = bounds.maxLat - bounds.minLat;
  
  // Use seeded random for consistency
  const rand = seededRandom(createSeedFromCenter(center) + 2);
  
  // Generate 1-2 saddles - INSIDE the parcel
  const numSaddles = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < numSaddles; i++) {
    // Generate saddle center inside parcel
    let saddleCenter: [number, number];
    if (parcelGeometry) {
      saddleCenter = generatePointInsideParcel(parcelGeometry, center, bounds, rand);
    } else {
      saddleCenter = [
        center[0] + (rand() - 0.5) * lngSpan * 0.2,
        center[1] + (rand() - 0.5) * latSpan * 0.2,
      ];
    }
    
    // Create slightly larger polygon for better clipping results
    const baseRadius = Math.min(lngSpan, latSpan) * 0.08;
    const radius = baseRadius * (0.6 + rand() * 0.6);
    let polygon = createIrregularPolygon(saddleCenter, radius, 6, rand);
    
    // CLIP polygon to parcel boundary using Turf.js
    if (parcelGeometry) {
      polygon = clipPolygonToParcel(polygon, parcelGeometry);
      
      // Skip if clipped polygon is degenerate
      if (polygon.length < 4) continue;
    }
    
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [polygon] },
      properties: {
        funnelType: 'saddle',
        narrowestWidthMeters: 30 + rand() * 50,
        corridorScore: 0.7 + rand() * 0.25,
      },
    });
  }
  
  // Generate 1-2 draws (as lines) - CLIPPED to parcel boundary
  const numDraws = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < numDraws; i++) {
    let startPoint: [number, number];
    let endPoint: [number, number];
    let midPoint: [number, number];
    
    if (parcelGeometry) {
      startPoint = generatePointInsideParcel(parcelGeometry, center, bounds, rand);
      endPoint = generatePointInsideParcel(parcelGeometry, center, bounds, rand);
      midPoint = generatePointInsideParcel(parcelGeometry, center, bounds, rand);
    } else {
      startPoint = [center[0] - lngSpan * 0.15, center[1] + latSpan * 0.1];
      endPoint = [center[0] + lngSpan * 0.15, center[1] - latSpan * 0.1];
      midPoint = [center[0], center[1]];
    }
    
    // Clip line to parcel boundary
    let lineCoords: number[][] = [startPoint, midPoint, endPoint];
    if (parcelGeometry) {
      lineCoords = clipLineToParcel(lineCoords, parcelGeometry);
      if (lineCoords.length < 2) continue; // Skip degenerate lines
    }
    
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: lineCoords },
      properties: {
        funnelType: 'draw',
        corridorScore: 0.65 + rand() * 0.3,
        flowAccumulation: 500 + rand() * 2000,
      },
    });
  }
  
  // Generate 1 corridor (least-cost path) - CLIPPED to parcel boundary
  let corridorStart: [number, number];
  let corridorEnd: [number, number];
  let corridorMid: [number, number];
  
  if (parcelGeometry) {
    corridorStart = generatePointInsideParcel(parcelGeometry, center, bounds, rand);
    corridorEnd = generatePointInsideParcel(parcelGeometry, center, bounds, rand);
    corridorMid = generatePointInsideParcel(parcelGeometry, center, bounds, rand);
  } else {
    corridorStart = [center[0] - lngSpan * 0.2, center[1]];
    corridorEnd = [center[0] + lngSpan * 0.2, center[1]];
    corridorMid = [center[0], center[1] + latSpan * 0.05];
  }
  
  // Clip corridor line to parcel
  let corridorCoords: number[][] = [corridorStart, corridorMid, corridorEnd];
  if (parcelGeometry) {
    corridorCoords = clipLineToParcel(corridorCoords, parcelGeometry);
  }
  
  if (corridorCoords.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: corridorCoords },
      properties: {
        funnelType: 'corridor',
        corridorScore: 0.8 + rand() * 0.15,
        leastCostPath: true,
        connectsBeddingToFood: true,
      },
    });
  }
  
  return { type: 'FeatureCollection', features };
}

function generateSyntheticStands(
  center: [number, number],
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  prevailingWinds: WindDirection[],
  bedding: GeoJSON.FeatureCollection<GeoJSON.Polygon, BeddingProperties>,
  funnels: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties>,
  parcelGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon
): GeoJSON.FeatureCollection<GeoJSON.Point, StandPointProperties> {
  const features: GeoJSON.Feature<GeoJSON.Point, StandPointProperties>[] = [];
  const lngSpan = bounds.maxLng - bounds.minLng;
  const latSpan = bounds.maxLat - bounds.minLat;
  
  // Use seeded random for consistency
  const rand = seededRandom(createSeedFromCenter(center) + 3);
  
  const allWinds: WindDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const badWinds = allWinds.filter(w => !prevailingWinds.includes(w)).slice(0, 3);
  
  const reasonings = [
    'Ridge saddle with excellent wind access, positioned between bedding and food source',
    'Draw intersection with multiple travel routes converging',
    'Elevated point overlooking primary corridor with thermal advantage',
    'Transition zone between thick cover and open timber',
    'Water feature crossing with predictable morning movement',
    'Bench on south slope, downwind of primary bedding',
    'Funnel pinch point where terrain forces movement through narrow gap',
    'Edge habitat with quick access to escape cover',
    'Ridge nose with 270° visibility of travel corridors',
    'Creek crossing with historical rub line nearby',
  ];
  
  // Generate 10 stand points - ALL must be INSIDE the parcel
  for (let i = 0; i < 10; i++) {
    let standPoint: [number, number];
    
    if (parcelGeometry) {
      // Generate point guaranteed inside parcel using Turf.js
      standPoint = generatePointInsideParcel(parcelGeometry, center, bounds, rand);
    } else {
      // Fallback: small offset from center
      standPoint = [
        center[0] + (rand() - 0.5) * lngSpan * 0.3,
        center[1] + (rand() - 0.5) * latSpan * 0.3,
      ];
    }
    
    // Calculate distances (approximate)
    const distToCorridor = 20 + rand() * 150;
    const distToBedding = 50 + rand() * 300;
    
    // Score decreases with rank
    const baseScore = 95 - i * 6 + rand() * 5;
    
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: standPoint },
      properties: {
        rank: i + 1,
        score: Math.round(Math.max(50, Math.min(99, baseScore))),
        windOk: prevailingWinds,
        windBad: badWinds as WindDirection[],
        approachRisk: i < 3 ? 'low' : (i < 7 ? 'medium' : 'high'),
        distToCorridorMeters: Math.round(distToCorridor),
        distToBeddingMeters: Math.round(distToBedding),
        elevation: 250 + rand() * 100,
        tpiLocal: (rand() - 0.3) * 2,
        tpiLandscape: (rand() - 0.5) * 2,
        reasoning: reasonings[i] || 'Strategic position based on terrain analysis',
      },
    });
  }
  
  // Sort by score descending
  features.sort((a, b) => (b.properties?.score || 0) - (a.properties?.score || 0));
  
  // Re-assign ranks after sorting
  features.forEach((f, idx) => {
    if (f.properties) f.properties.rank = idx + 1;
  });
  
  return { type: 'FeatureCollection', features };
}

function createIrregularPolygon(
  center: [number, number], 
  radius: number, 
  points: number,
  rand?: () => number
): number[][] {
  const r = rand || Math.random;
  const coords: number[][] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const randomRadius = radius * (0.7 + r() * 0.6);
    coords.push([
      center[0] + randomRadius * Math.cos(angle),
      center[1] + randomRadius * Math.sin(angle) * 0.8, // slightly flattened
    ]);
  }
  coords.push(coords[0]); // close polygon
  return coords;
}

// ============ Service Health Check ============

export async function checkTerrainBrainHealth(): Promise<{ available: boolean; latencyMs?: number }> {
  if (!GEOPROCESSOR_URL) {
    return { available: false };
  }

  const start = Date.now();
  try {
    const response = await fetch(`${GEOPROCESSOR_URL}/v1/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return {
      available: response.ok,
      latencyMs: Date.now() - start,
    };
  } catch {
    return { available: false };
  }
}
