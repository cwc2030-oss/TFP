// Terra Firma Terrain Analysis API Route
// Proxies to external Modal.com geoprocessor or returns preview analysis
// The external service URL is kept server-side only (not NEXT_PUBLIC_)

import { NextRequest, NextResponse } from 'next/server';
import { generatePreviewAnalysis, checkTerrainBrainHealth } from '@/lib/terrain-brain';
import type { TerrainAnalysisRequest, TerrainAnalysisError, TerrainAnalysisResponse } from '@/types/terrain';

const MAX_AOI_ACRES = 5000;
const REQUEST_TIMEOUT_MS = 120000; // 120 seconds for real DEM processing

// Server-side only - Modal.com service URL
const GEOPROCESSOR_URL = process.env.GEOPROCESSOR_API_URL;

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body = await request.json();
    const { parcel, bufferMeters, seasonProfile, prevailingWinds, forcePreview } = body as TerrainAnalysisRequest & { forcePreview?: boolean };

    // Validate parcel geometry - accept both Polygon and MultiPolygon
    if (!parcel || !parcel.geometry || (parcel.geometry.type !== 'Polygon' && parcel.geometry.type !== 'MultiPolygon')) {
      return NextResponse.json(
        { code: 'INVALID_GEOMETRY', message: 'Valid parcel polygon or multipolygon required' },
        { status: 400 }
      );
    }

    // Extract coordinates based on geometry type
    const coords = (parcel.geometry.type === 'Polygon' 
      ? parcel.geometry.coordinates[0]
      : parcel.geometry.coordinates[0][0]) as number[][]; // First polygon of MultiPolygon
    const estimatedAcres = estimatePolygonAcres(coords);
    const bufferAcres = ((bufferMeters || 800) * (bufferMeters || 800) * Math.PI) / 4046.86;
    const totalAcres = estimatedAcres + bufferAcres;
    
    if (totalAcres > MAX_AOI_ACRES) {
      return NextResponse.json(
        { 
          code: 'AOI_TOO_LARGE', 
          message: `Analysis area (${Math.round(totalAcres)} acres) exceeds maximum (${MAX_AOI_ACRES} acres)`,
          fallbackToPreview: false
        },
        { status: 400 }
      );
    }

    const options = {
      bufferMeters: bufferMeters || 800,
      seasonProfile: seasonProfile || 'rut',
      prevailingWinds: prevailingWinds || ['NW'],
    };

    // If preview forced or no service URL configured, use preview mode
    // NOTE: Temporarily forcing preview mode while Modal endpoint is debugged
    const usePreviewMode = true; // forcePreview || !GEOPROCESSOR_URL
    if (usePreviewMode) {
      console.log('Using preview mode (Modal endpoint temporarily disabled)');
      const result = generatePreviewAnalysis(parcel, options);
      result.provenance.processingTimeSeconds = (Date.now() - startTime) / 1000;
      
      return NextResponse.json(result, {
        headers: {
          'X-Terrain-Mode': 'preview',
          'X-Processing-Time-Ms': String(Date.now() - startTime),
        },
      });
    }

    // Call external Modal.com geoprocessor
    try {
      console.log('Calling Terrain Brain at:', GEOPROCESSOR_URL);
      
      const response = await fetch(GEOPROCESSOR_URL!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parcel,
          bufferMeters: options.bufferMeters,
          seasonProfile: options.seasonProfile,
          prevailingWinds: options.prevailingWinds,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Geoprocessor error:', response.status, errorText);
        throw new Error(`Geoprocessor returned ${response.status}`);
      }

      const result = await response.json() as TerrainAnalysisResponse;

      // Check for error in response body
      if ((result as any).error) {
        console.error('Geoprocessor returned error:', (result as any).message);
        throw new Error((result as any).message || 'Geoprocessor error');
      }

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

    } catch (fetchError) {
      // Fallback to preview mode on any error
      console.warn('Geoprocessor unavailable, falling back to preview:', fetchError);
      
      const result = generatePreviewAnalysis(parcel, options);
      result.provenance.processingTimeSeconds = (Date.now() - startTime) / 1000;
      
      return NextResponse.json(result, {
        headers: {
          'X-Terrain-Mode': 'preview',
          'X-Terrain-Fallback': 'true',
          'X-Processing-Time-Ms': String(Date.now() - startTime),
        },
      });
    }

  } catch (error) {
    console.error('Terrain analysis error:', error);
    
    const terrainError = error as TerrainAnalysisError;
    
    if (terrainError.code) {
      return NextResponse.json(
        { 
          code: terrainError.code, 
          message: terrainError.message,
          fallbackToPreview: terrainError.fallbackToPreview 
        },
        { status: getStatusCode(terrainError.code) }
      );
    }

    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Terrain analysis failed unexpectedly' },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Health check endpoint
  try {
    const health = await checkTerrainBrainHealth();
    
    return NextResponse.json({
      status: health.available ? 'healthy' : 'degraded',
      realModeAvailable: health.available,
      previewModeAvailable: true,
      latencyMs: health.latencyMs,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      status: 'degraded',
      realModeAvailable: false,
      previewModeAvailable: true,
      timestamp: new Date().toISOString(),
    });
  }
}

// ============ Helper Functions ============

function estimatePolygonAcres(coords: number[][]): number {
  // Shoelace formula
  let area = 0;
  const n = coords.length - 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += coords[i][0] * coords[j][1];
    area -= coords[j][0] * coords[i][1];
  }
  area = Math.abs(area) / 2;
  // Convert degrees² to acres (~40° latitude assumption)
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
