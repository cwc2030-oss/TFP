// Terra Firma Terrain Analysis API Route
// Proxies to Python geoprocessor on Modal - v3.3 (Feb 27, 2026)

import { NextRequest, NextResponse } from 'next/server';
import type { TerrainAnalysisRequest, TerrainAnalysisError, TerrainAnalysisResponse } from '@/types/terrain';

const MAX_AOI_ACRES = 5000;
const REQUEST_TIMEOUT_MS = 55_000; // 55 seconds — territory multi-parcel needs headroom

// HARDCODED Modal v3 URL - do NOT rely on env vars for this critical path
const GEOPROCESSOR_URL = 'https://cwc2030--terrain-brain-v3-web.modal.run/v1/terrain-analysis';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const reqId = Math.random().toString(36).substring(2, 8);
  
  console.log(`[Terrain:${reqId}] === REQUEST START ===`);
  
  try {
    const body = await request.json();
    const { parcel, bufferMeters, seasonProfile, prevailingWinds } = body as TerrainAnalysisRequest;

    // Validate parcel geometry - accept both Polygon and MultiPolygon
    if (!parcel || !parcel.geometry || (parcel.geometry.type !== 'Polygon' && parcel.geometry.type !== 'MultiPolygon')) {
      console.log(`[Terrain:${reqId}] Invalid geometry`);
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

    console.log(`[Terrain:${reqId}] Acres: ${Math.round(estimatedAcres)}, timeout: ${REQUEST_TIMEOUT_MS}ms`);
    
    const fetchStart = Date.now();
    
    // Use AbortSignal.timeout() - modern approach that works better in edge runtime
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    
    console.log(`[Terrain:${reqId}] Fetch to Modal starting...`);
    
    let response: Response;
    try {
      response = await fetch(GEOPROCESSOR_URL, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          parcel,
          bufferMeters: bufferMeters || 800,
          seasonProfile: seasonProfile || 'rut',
          prevailingWinds: prevailingWinds || ['NW'],
        }),
        signal: timeoutSignal,
        cache: 'no-store', // Bypass any caching
      });
      
      const fetchDuration = Date.now() - fetchStart;
      console.log(`[Terrain:${reqId}] Modal responded in ${fetchDuration}ms, status: ${response.status}`);
      
    } catch (fetchErr) {
      const elapsed = Date.now() - fetchStart;
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      const errName = fetchErr instanceof Error ? fetchErr.name : 'Unknown';
      console.error(`[Terrain:${reqId}] FETCH FAILED after ${elapsed}ms:`, errName, errMsg);
      
      // Handle timeout
      if (errName === 'AbortError' || errName === 'TimeoutError' || errMsg.includes('timeout')) {
        return NextResponse.json(
          { code: 'TIMEOUT', message: `Request timed out after ${Math.round(elapsed/1000)}s. Please try again.` },
          { status: 504 }
        );
      }
      
      // Network errors
      return NextResponse.json(
        { code: 'NETWORK_ERROR', message: `Network error: ${errMsg}` },
        { status: 503 }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Terrain:${reqId}] Modal error:`, response.status, errorText.slice(0, 200));
      return NextResponse.json(
        { code: 'SERVICE_ERROR', message: `Service error: ${response.status}` },
        { status: 502 }
      );
    }

    console.log(`[Terrain:${reqId}] Parsing response JSON...`);
    const result = await response.json() as TerrainAnalysisResponse;
    const totalDuration = Date.now() - startTime;
    
    console.log(`[Terrain:${reqId}] === SUCCESS === Total: ${totalDuration}ms, mode: ${result.mode}`);

    // Update processing time to include network latency
    if (result.provenance) {
      result.provenance.processingTimeSeconds = totalDuration / 1000;
    }

    return NextResponse.json(result, {
      headers: {
        'X-Terrain-Mode': result.mode || 'real',
        'X-Processing-Time-Ms': String(totalDuration),
        'X-Request-Id': reqId,
      },
    });

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[Terrain:${reqId}] UNHANDLED ERROR after ${elapsed}ms:`, error);
    
    const terrainError = error as TerrainAnalysisError;
    
    if (terrainError.code) {
      return NextResponse.json(
        { code: terrainError.code, message: terrainError.message },
        { status: getStatusCode(terrainError.code) }
      );
    }

    return NextResponse.json(
      { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' },
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
// Deployed with Modal v3: Fri Feb 20 23:51:17 UTC 2026
