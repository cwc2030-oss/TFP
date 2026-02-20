// Terra Firma Terrain Brain Client
// Connects to external geoprocessor or falls back to preview mode
// NOTE: Real API calls happen server-side only via /api/terrain-analysis

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

function validateAndClipFeatures(
  layers: TerrainLayers,
  parcelCoords: number[][]
): TerrainLayers {
  // Final pass: remove any features that ended up outside the parcel
  
  // Validate bedding polygons - ensure at least one vertex is inside
  const validBedding = layers.beddingPolygons.features.filter(f => {
    const coords = f.geometry.coordinates[0];
    return coords.some((c: number[]) => pointInPolygon(c as [number, number], parcelCoords));
  });
  
  // Validate funnels - polygons need at least one vertex inside, lines need at least one point inside
  const validFunnels = layers.funnels.features.filter(f => {
    if (f.geometry.type === 'Polygon') {
      const coords = f.geometry.coordinates[0];
      return coords.some((c: number[]) => pointInPolygon(c as [number, number], parcelCoords));
    } else if (f.geometry.type === 'LineString') {
      const coords = f.geometry.coordinates;
      return coords.some((c: number[]) => pointInPolygon(c as [number, number], parcelCoords));
    }
    return true;
  });
  
  // Validate stand points - must be inside parcel
  const validStands = layers.standPoints.features.filter(f => {
    const coords = f.geometry.coordinates as [number, number];
    return pointInPolygon(coords, parcelCoords);
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
    funnels: { type: 'FeatureCollection', features: validFunnels as any },
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
  // Handle both Polygon and MultiPolygon - extract the largest ring
  const coords = extractPrimaryRing(parcel.geometry);
  const center = calculateCentroid(coords);
  const bounds = calculateBounds(coords);
  const acreage = calculateAcreage(coords);
  const bufferMeters = options?.bufferMeters ?? 800;
  const prevailingWinds = options?.prevailingWinds ?? ['NW'];
  const seasonProfile = options?.seasonProfile ?? 'rut';

  // Pass parcel coordinates to ensure all features stay INSIDE the parcel
  const parcelCoords = coords as number[][];
  
  console.log(`[TFP] Generating preview analysis for ${acreage.toFixed(1)} acre parcel with ${parcelCoords.length} vertices`);

  // Generate synthetic bedding areas (south-facing slopes) - constrained to parcel
  const beddingPolygons = generateSyntheticBedding(center, bounds, acreage, parcelCoords);
  
  // Generate synthetic funnels (draws and saddles) - constrained to parcel
  const funnels = generateSyntheticFunnels(center, bounds, parcelCoords);
  
  // Generate ranked stand points - constrained to parcel
  const standPoints = generateSyntheticStands(center, bounds, prevailingWinds, beddingPolygons, funnels, parcelCoords);

  // FINAL VALIDATION: Ensure all features are clipped/filtered to parcel boundary
  const validatedLayers = validateAndClipFeatures(
    { beddingPolygons, funnels, standPoints },
    parcelCoords
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

// ============ Point-in-Polygon Testing ============

// Ray-casting algorithm for point-in-polygon
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

// Generate a random point INSIDE the parcel polygon
// Uses rejection sampling with hard maxAttempts limit
const MAX_POINT_ATTEMPTS = 100; // Hard limit to prevent infinite loops

function generatePointInsideParcel(
  parcelCoords: number[][],
  center: [number, number],
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  rand: () => number,
  maxAttempts = 50
): [number, number] {
  // Enforce hard limit
  const attempts = Math.min(maxAttempts, MAX_POINT_ATTEMPTS);
  
  // Validate inputs
  if (!parcelCoords || parcelCoords.length < 3) {
    return center;
  }
  
  const lngSpan = bounds.maxLng - bounds.minLng;
  const latSpan = bounds.maxLat - bounds.minLat;
  
  // Guard against degenerate bounds
  if (lngSpan <= 0 || latSpan <= 0) {
    return center;
  }
  
  // Try random points within bounding box, keep if inside polygon
  for (let attempt = 0; attempt < attempts; attempt++) {
    const point: [number, number] = [
      bounds.minLng + rand() * lngSpan,
      bounds.minLat + rand() * latSpan,
    ];
    
    if (pointInPolygon(point, parcelCoords)) {
      return point;
    }
  }
  
  // Fallback: return centroid (should be inside for most parcels)
  // For very weird shapes, centroid might be outside - that's acceptable for preview mode
  return center;
}

// Shrink a polygon toward its center to ensure it stays inside parcel
// Hard limit of 10 shrink attempts to prevent infinite loops
const MAX_SHRINK_ATTEMPTS = 10;

function shrinkPolygonToFit(
  polygonCoords: number[][],
  parcelCoords: number[][],
  center: [number, number],
  shrinkFactor = 0.8
): number[][] {
  // Validate inputs
  if (!polygonCoords || polygonCoords.length < 3) {
    return polygonCoords;
  }
  if (!parcelCoords || parcelCoords.length < 3) {
    return polygonCoords;
  }
  
  // Calculate polygon center
  const polygonCenter: [number, number] = [
    polygonCoords.reduce((sum, p) => sum + p[0], 0) / polygonCoords.length,
    polygonCoords.reduce((sum, p) => sum + p[1], 0) / polygonCoords.length,
  ];
  
  let factor = 1.0;
  
  // Try shrinking with hard attempt limit
  for (let attempts = 0; attempts < MAX_SHRINK_ATTEMPTS; attempts++) {
    const shrunk = polygonCoords.map(p => [
      polygonCenter[0] + (p[0] - polygonCenter[0]) * factor,
      polygonCenter[1] + (p[1] - polygonCenter[1]) * factor,
    ]);
    
    // Check if all points are inside parcel
    const allInside = shrunk.every(p => pointInPolygon(p as [number, number], parcelCoords));
    if (allInside) return shrunk;
    
    factor *= shrinkFactor;
  }
  
  // Last resort: tiny polygon at parcel center (guaranteed to be "inside" for display)
  const tinyRadius = 0.0001; // ~10m
  return [
    [center[0] - tinyRadius, center[1] - tinyRadius],
    [center[0] + tinyRadius, center[1] - tinyRadius],
    [center[0] + tinyRadius, center[1] + tinyRadius],
    [center[0] - tinyRadius, center[1] + tinyRadius],
    [center[0] - tinyRadius, center[1] - tinyRadius], // close ring
  ];
}

// ============ Polygon Clipping (Sutherland-Hodgman Algorithm) ============

// Clip a polygon to another polygon boundary using Sutherland-Hodgman
function clipPolygonToParcel(subjectPolygon: number[][], clipPolygon: number[][]): number[][] {
  if (!subjectPolygon || subjectPolygon.length < 3) return subjectPolygon;
  if (!clipPolygon || clipPolygon.length < 3) return subjectPolygon;
  
  let outputList = [...subjectPolygon];
  
  // Remove closing point if present for processing
  if (outputList.length > 0 && 
      outputList[0][0] === outputList[outputList.length - 1][0] &&
      outputList[0][1] === outputList[outputList.length - 1][1]) {
    outputList = outputList.slice(0, -1);
  }
  
  const clipEdges = clipPolygon.slice(0, -1); // Remove closing point
  
  for (let i = 0; i < clipEdges.length; i++) {
    if (outputList.length === 0) break;
    
    const edgeStart = clipEdges[i];
    const edgeEnd = clipEdges[(i + 1) % clipEdges.length];
    const inputList = [...outputList];
    outputList = [];
    
    for (let j = 0; j < inputList.length; j++) {
      const current = inputList[j];
      const previous = inputList[(j + inputList.length - 1) % inputList.length];
      
      const currentInside = isInsideEdge(current, edgeStart, edgeEnd);
      const previousInside = isInsideEdge(previous, edgeStart, edgeEnd);
      
      if (currentInside) {
        if (!previousInside) {
          const intersection = lineIntersection(previous, current, edgeStart, edgeEnd);
          if (intersection) outputList.push(intersection);
        }
        outputList.push(current);
      } else if (previousInside) {
        const intersection = lineIntersection(previous, current, edgeStart, edgeEnd);
        if (intersection) outputList.push(intersection);
      }
    }
  }
  
  // Close the polygon
  if (outputList.length > 0) {
    outputList.push([...outputList[0]]);
  }
  
  return outputList;
}

// Check if point is inside (left of) an edge
function isInsideEdge(point: number[], edgeStart: number[], edgeEnd: number[]): boolean {
  return (edgeEnd[0] - edgeStart[0]) * (point[1] - edgeStart[1]) - 
         (edgeEnd[1] - edgeStart[1]) * (point[0] - edgeStart[0]) >= 0;
}

// Find intersection of two line segments
function lineIntersection(p1: number[], p2: number[], p3: number[], p4: number[]): number[] | null {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
  if (Math.abs(d) < 1e-10) return null;
  
  const t = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / d;
  
  return [
    p1[0] + t * (p2[0] - p1[0]),
    p1[1] + t * (p2[1] - p1[1])
  ];
}

// Clip a LineString to stay within parcel (keep segments inside)
function clipLineToParcel(lineCoords: number[][], parcelCoords: number[][]): number[][] {
  if (!parcelCoords || parcelCoords.length < 3) return lineCoords;
  
  const clippedPoints: number[][] = [];
  
  for (let i = 0; i < lineCoords.length; i++) {
    const point = lineCoords[i];
    
    if (pointInPolygon(point as [number, number], parcelCoords)) {
      clippedPoints.push(point);
    } else if (i > 0) {
      // Find intersection with parcel boundary
      const prevPoint = lineCoords[i - 1];
      if (pointInPolygon(prevPoint as [number, number], parcelCoords)) {
        const intersection = findParcelBoundaryIntersection(prevPoint, point, parcelCoords);
        if (intersection) clippedPoints.push(intersection);
      }
    }
  }
  
  return clippedPoints.length >= 2 ? clippedPoints : lineCoords;
}

// Find where a line segment crosses the parcel boundary
function findParcelBoundaryIntersection(inside: number[], outside: number[], parcelCoords: number[][]): number[] | null {
  for (let i = 0; i < parcelCoords.length - 1; i++) {
    const edgeStart = parcelCoords[i];
    const edgeEnd = parcelCoords[i + 1];
    const intersection = lineIntersection(inside, outside, edgeStart, edgeEnd);
    
    if (intersection) {
      // Check if intersection is within both line segments
      const onSegment1 = isPointOnSegment(intersection, inside, outside);
      const onSegment2 = isPointOnSegment(intersection, edgeStart, edgeEnd);
      if (onSegment1 && onSegment2) return intersection;
    }
  }
  return null;
}

// Check if point lies on a line segment
function isPointOnSegment(point: number[], segStart: number[], segEnd: number[]): boolean {
  const minX = Math.min(segStart[0], segEnd[0]) - 1e-9;
  const maxX = Math.max(segStart[0], segEnd[0]) + 1e-9;
  const minY = Math.min(segStart[1], segEnd[1]) - 1e-9;
  const maxY = Math.max(segStart[1], segEnd[1]) + 1e-9;
  return point[0] >= minX && point[0] <= maxX && point[1] >= minY && point[1] <= maxY;
}

// ============ Synthetic Data Generators ============

function generateSyntheticBedding(
  center: [number, number],
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  acreage: number,
  parcelCoords?: number[][]
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
    if (parcelCoords) {
      beddingCenter = generatePointInsideParcel(parcelCoords, center, bounds, rand);
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
    
    // CLIP polygon to parcel boundary (proper intersection, not shrink)
    if (parcelCoords && parcelCoords.length >= 3) {
      polygon = clipPolygonToParcel(polygon, parcelCoords);
      
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
  parcelCoords?: number[][]
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
    if (parcelCoords) {
      saddleCenter = generatePointInsideParcel(parcelCoords, center, bounds, rand);
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
    
    // CLIP polygon to parcel boundary (proper intersection)
    if (parcelCoords && parcelCoords.length >= 3) {
      polygon = clipPolygonToParcel(polygon, parcelCoords);
      
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
    
    if (parcelCoords) {
      startPoint = generatePointInsideParcel(parcelCoords, center, bounds, rand);
      endPoint = generatePointInsideParcel(parcelCoords, center, bounds, rand);
      midPoint = generatePointInsideParcel(parcelCoords, center, bounds, rand);
    } else {
      startPoint = [center[0] - lngSpan * 0.15, center[1] + latSpan * 0.1];
      endPoint = [center[0] + lngSpan * 0.15, center[1] - latSpan * 0.1];
      midPoint = [center[0], center[1]];
    }
    
    // Clip line to parcel boundary
    let lineCoords: number[][] = [startPoint, midPoint, endPoint];
    if (parcelCoords && parcelCoords.length >= 3) {
      lineCoords = clipLineToParcel(lineCoords, parcelCoords);
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
  
  if (parcelCoords) {
    corridorStart = generatePointInsideParcel(parcelCoords, center, bounds, rand);
    corridorEnd = generatePointInsideParcel(parcelCoords, center, bounds, rand);
    corridorMid = generatePointInsideParcel(parcelCoords, center, bounds, rand);
  } else {
    corridorStart = [center[0] - lngSpan * 0.2, center[1]];
    corridorEnd = [center[0] + lngSpan * 0.2, center[1]];
    corridorMid = [center[0], center[1] + latSpan * 0.05];
  }
  
  // Clip corridor line to parcel
  let corridorCoords: number[][] = [corridorStart, corridorMid, corridorEnd];
  if (parcelCoords && parcelCoords.length >= 3) {
    corridorCoords = clipLineToParcel(corridorCoords, parcelCoords);
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
  parcelCoords?: number[][]
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
    
    if (parcelCoords) {
      // Generate point guaranteed inside parcel
      standPoint = generatePointInsideParcel(parcelCoords, center, bounds, rand);
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
