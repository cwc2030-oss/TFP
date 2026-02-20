// Terra Firma Terrain Analysis API Route
// Proxies to Python geoprocessor service - NO synthetic/preview fallback

import { NextRequest, NextResponse } from 'next/server';
import type { TerrainAnalysisRequest, TerrainAnalysisError, TerrainAnalysisResponse } from '@/types/terrain';

const MAX_AOI_ACRES = 5000;
const REQUEST_TIMEOUT_MS = 60000; // 60 seconds

// Python geoprocessor service URL
const GEOPROCESSOR_URL = process.env.GEOPROCESSOR_API_URL || 'http://localhost:8001/v1/terrain-analysis';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body = await request.json();
    const { parcel, bufferMeters, seasonProfile, prevailingWinds } = body as TerrainAnalysisRequest;

    // Validate parcel geometry - accept both Polygon and MultiPolygon
    if (!parcel || !parcel.geometry || (parcel.geometry.type !== 'Polygon' && parcel.geometry.type !== 'MultiPolygon')) {
      return NextResponse.json(
        { code: 'INVALID_GEOMETRY', message: 'Valid parcel polygon or multipolygon required' },
        { status: 400 }
      );
    }

    // Extract coordinates for size check
    const coords = (parcel.geometry.type === 'Polygon' 
      ? parcel.geometry.coordinates[0]
      : parcel.geometry.coordinates[0][0]) as number[][];
    const estimatedAcres = estimatePolygonAcres(coords);
    
    if (estimatedAcres > MAX_AOI_ACRES) {
      return NextResponse.json(
        { 
          code: 'AOI_TOO_LARGE', 
          message: `Parcel (${Math.round(estimatedAcres)} acres) exceeds maximum (${MAX_AOI_ACRES} acres)`,
        },
        { status: 400 }
      );
    }

    // Call Python geoprocessor - NO FALLBACK
    console.log('[Terrain] Calling geoprocessor:', GEOPROCESSOR_URL);
    
    const response = await fetch(GEOPROCESSOR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parcel,
        bufferMeters: bufferMeters || 800,
        seasonProfile: seasonProfile || 'rut',
        prevailingWinds: prevailingWinds || ['NW'],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Terrain] Geoprocessor error:', response.status, errorText);
      return NextResponse.json(
        { code: 'SERVICE_ERROR', message: 'Terrain analysis service error' },
        { status: 502 }
      );
    }

    const result = await response.json() as TerrainAnalysisResponse;

    // Update processing time to include network latency
    if (result.provenance) {
      result.provenance.processingTimeSeconds = (Date.now() - startTime) / 1000;
    }

    return NextResponse.json(result, {
      headers: {
        'X-Terrain-Mode': result.mode || 'real',
        'X-Processing-Time-Ms': String(Date.now() - startTime),
      },
    });

  } catch (error) {
    console.error('[Terrain] Analysis error:', error);
    
    const terrainError = error as TerrainAnalysisError;
    
    if (terrainError.code) {
      return NextResponse.json(
        { code: terrainError.code, message: terrainError.message },
        { status: getStatusCode(terrainError.code) }
      );
    }

    // Check for timeout
    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json(
        { code: 'TIMEOUT', message: 'Terrain analysis timed out' },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { code: 'SERVICE_UNAVAILABLE', message: 'Terrain analysis service unavailable' },
      { status: 503 }
    );
  }
}

export async function GET() {
  // Health check - ping the Python service
  try {
    const healthUrl = GEOPROCESSOR_URL.replace('/v1/terrain-analysis', '/health');
    const response = await fetch(healthUrl, { 
      signal: AbortSignal.timeout(5000) 
    });
    
    if (response.ok) {
      const health = await response.json();
      return NextResponse.json({
        status: 'healthy',
        geoprocessor: health,
        timestamp: new Date().toISOString(),
      });
    }
    
    return NextResponse.json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      status: 'unavailable',
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}

// ============ Helper Functions ============

function estimatePolygonAcres(coords: number[][]): number {
  let area = 0;
  const n = coords.length - 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += coords[i][0] * coords[j][1];
    area -= coords[j][0] * coords[i][1];
  }
  area = Math.abs(area) / 2;
  const metersPerDegLng = 85000;
  const metersPerDegLat = 111000;
  const sqMeters = area * metersPerDegLng * metersPerDegLat;
  return sqMeters / 4046.86;
}

function getStatusCode(code: TerrainAnalysisError['code']): number {
  switch (code) {
    case 'AOI_TOO_LARGE':
    case 'INVALID_GEOMETRY':
      return 400;
    case 'DEM_UNAVAILABLE':
    case 'SERVICE_UNAVAILABLE':
      return 503;
    case 'PROCESSING_TIMEOUT':
      return 504;
    default:
      return 500;
  }
}
