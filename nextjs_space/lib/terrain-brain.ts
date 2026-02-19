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

export function generatePreviewAnalysis(
  parcel: GeoJSON.Feature<GeoJSON.Polygon>,
  options?: {
    bufferMeters?: number;
    seasonProfile?: SeasonProfile;
    prevailingWinds?: WindDirection[];
  }
): TerrainAnalysisResponse {
  const coords = parcel.geometry.coordinates[0];
  const center = calculateCentroid(coords);
  const bounds = calculateBounds(coords);
  const acreage = calculateAcreage(coords);
  const bufferMeters = options?.bufferMeters ?? 800;
  const prevailingWinds = options?.prevailingWinds ?? ['NW'];
  const seasonProfile = options?.seasonProfile ?? 'rut';

  // Generate synthetic bedding areas (south-facing slopes)
  const beddingPolygons = generateSyntheticBedding(center, bounds, acreage);
  
  // Generate synthetic funnels (draws and saddles)
  const funnels = generateSyntheticFunnels(center, bounds);
  
  // Generate ranked stand points
  const standPoints = generateSyntheticStands(center, bounds, prevailingWinds, beddingPolygons, funnels);

  const layers: TerrainLayers = {
    beddingPolygons,
    funnels,
    standPoints,
  };

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

// ============ Synthetic Data Generators ============

function generateSyntheticBedding(
  center: [number, number],
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  acreage: number
): GeoJSON.FeatureCollection<GeoJSON.Polygon, BeddingProperties> {
  const features: GeoJSON.Feature<GeoJSON.Polygon, BeddingProperties>[] = [];
  const lngSpan = bounds.maxLng - bounds.minLng;
  const latSpan = bounds.maxLat - bounds.minLat;
  
  // Generate 2-4 bedding areas based on property size
  const numBedding = Math.min(4, Math.max(2, Math.floor(acreage / 50)));
  
  for (let i = 0; i < numBedding; i++) {
    // Place bedding areas on south-facing slopes (southern portions of property)
    const offsetLng = (Math.random() - 0.5) * lngSpan * 0.6;
    const offsetLat = -Math.random() * latSpan * 0.3 - latSpan * 0.1; // bias south
    
    const beddingCenter: [number, number] = [
      center[0] + offsetLng,
      center[1] + offsetLat,
    ];
    
    // Create irregular polygon
    const radius = 0.001 + Math.random() * 0.002; // ~100-300m radius
    const polygon = createIrregularPolygon(beddingCenter, radius, 6 + Math.floor(Math.random() * 4));
    
    const aspectDegrees = 135 + Math.random() * 90; // 135-225 (south-facing)
    const aspectLabels = ['S', 'SW', 'SE'];
    
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [polygon] },
      properties: {
        type: i === 0 ? 'thermal_bedding' : (Math.random() > 0.5 ? 'transition_bedding' : 'escape_cover'),
        slopeRange: [8 + Math.random() * 4, 18 + Math.random() * 7],
        aspect: aspectLabels[Math.floor(Math.random() * aspectLabels.length)],
        aspectDegrees,
        areaAcres: 0.5 + Math.random() * 3,
        confidence: 0.6 + Math.random() * 0.3,
      },
    });
  }
  
  return { type: 'FeatureCollection', features };
}

function generateSyntheticFunnels(
  center: [number, number],
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number }
): GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties> {
  const features: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties>[] = [];
  const lngSpan = bounds.maxLng - bounds.minLng;
  const latSpan = bounds.maxLat - bounds.minLat;
  
  // Generate 1-2 saddles
  for (let i = 0; i < 1 + Math.floor(Math.random() * 2); i++) {
    const saddleCenter: [number, number] = [
      center[0] + (Math.random() - 0.5) * lngSpan * 0.5,
      center[1] + (Math.random() - 0.5) * latSpan * 0.5,
    ];
    
    const polygon = createIrregularPolygon(saddleCenter, 0.0008, 5);
    
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [polygon] },
      properties: {
        funnelType: 'saddle',
        narrowestWidthMeters: 30 + Math.random() * 50,
        corridorScore: 0.7 + Math.random() * 0.25,
      },
    });
  }
  
  // Generate 1-2 draws (as lines)
  for (let i = 0; i < 1 + Math.floor(Math.random() * 2); i++) {
    const startPoint: [number, number] = [
      bounds.minLng + Math.random() * lngSpan * 0.3,
      bounds.maxLat - Math.random() * latSpan * 0.2,
    ];
    const endPoint: [number, number] = [
      bounds.maxLng - Math.random() * lngSpan * 0.3,
      bounds.minLat + Math.random() * latSpan * 0.2,
    ];
    
    // Create slightly curved line
    const midPoint: [number, number] = [
      (startPoint[0] + endPoint[0]) / 2 + (Math.random() - 0.5) * lngSpan * 0.1,
      (startPoint[1] + endPoint[1]) / 2 + (Math.random() - 0.5) * latSpan * 0.1,
    ];
    
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [startPoint, midPoint, endPoint] },
      properties: {
        funnelType: 'draw',
        corridorScore: 0.65 + Math.random() * 0.3,
        flowAccumulation: 500 + Math.random() * 2000,
      },
    });
  }
  
  // Generate 1 corridor (least-cost path)
  const corridorStart: [number, number] = [
    bounds.minLng + lngSpan * 0.1,
    center[1] + (Math.random() - 0.5) * latSpan * 0.3,
  ];
  const corridorEnd: [number, number] = [
    bounds.maxLng - lngSpan * 0.1,
    center[1] + (Math.random() - 0.5) * latSpan * 0.3,
  ];
  const corridorMid: [number, number] = [
    center[0],
    center[1] + (Math.random() - 0.5) * latSpan * 0.2,
  ];
  
  features.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [corridorStart, corridorMid, corridorEnd] },
    properties: {
      funnelType: 'corridor',
      corridorScore: 0.8 + Math.random() * 0.15,
      leastCostPath: true,
      connectsBeddingToFood: true,
    },
  });
  
  return { type: 'FeatureCollection', features };
}

function generateSyntheticStands(
  center: [number, number],
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number },
  prevailingWinds: WindDirection[],
  bedding: GeoJSON.FeatureCollection<GeoJSON.Polygon, BeddingProperties>,
  funnels: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.LineString, FunnelProperties>
): GeoJSON.FeatureCollection<GeoJSON.Point, StandPointProperties> {
  const features: GeoJSON.Feature<GeoJSON.Point, StandPointProperties>[] = [];
  const lngSpan = bounds.maxLng - bounds.minLng;
  const latSpan = bounds.maxLat - bounds.minLat;
  
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
  
  // Generate 10 stand points
  for (let i = 0; i < 10; i++) {
    const standPoint: [number, number] = [
      center[0] + (Math.random() - 0.5) * lngSpan * 0.8,
      center[1] + (Math.random() - 0.5) * latSpan * 0.8,
    ];
    
    // Calculate distances (approximate)
    const distToCorridor = 20 + Math.random() * 150;
    const distToBedding = 50 + Math.random() * 300;
    
    // Score decreases with rank
    const baseScore = 95 - i * 6 + Math.random() * 5;
    
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
        elevation: 250 + Math.random() * 100,
        tpiLocal: (Math.random() - 0.3) * 2,
        tpiLandscape: (Math.random() - 0.5) * 2,
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

function createIrregularPolygon(center: [number, number], radius: number, points: number): number[][] {
  const coords: number[][] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const r = radius * (0.7 + Math.random() * 0.6);
    coords.push([
      center[0] + r * Math.cos(angle),
      center[1] + r * Math.sin(angle) * 0.8, // slightly flattened
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
