// Terra Firma Terrain Analysis API Route
// Proxies to external geoprocessor or returns preview analysis

import { NextRequest, NextResponse } from 'next/server';
import { analyzeTerrainWithFallback, checkTerrainBrainHealth } from '@/lib/terrain-brain';
import type { TerrainAnalysisRequest, TerrainAnalysisError } from '@/types/terrain';

const MAX_AOI_ACRES = 5000;
const REQUEST_TIMEOUT_MS = 90000; // 90 seconds total

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body = await request.json();
    const { parcel, bufferMeters, seasonProfile, prevailingWinds, forcePreview } = body as TerrainAnalysisRequest & { forcePreview?: boolean };

    // Validate parcel geometry
    if (!parcel || !parcel.geometry || parcel.geometry.type !== 'Polygon') {
      return NextResponse.json(
        { code: 'INVALID_GEOMETRY', message: 'Valid parcel polygon required' },
        { status: 400 }
      );
    }

    // Validate AOI size (rough calculation)
    const coords = parcel.geometry.coordinates[0];
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

    // Run analysis with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const result = await analyzeTerrainWithFallback(parcel, {
        bufferMeters: bufferMeters || 800,
        seasonProfile: seasonProfile || 'rut',
        prevailingWinds: prevailingWinds || ['NW'],
        forcePreview: forcePreview || false,
      });

      clearTimeout(timeoutId);

      // Add processing time to provenance
      result.provenance.processingTimeSeconds = (Date.now() - startTime) / 1000;

      return NextResponse.json(result, {
        headers: {
          'X-Terrain-Mode': result.mode,
          'X-Processing-Time-Ms': String(Date.now() - startTime),
        },
      });
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
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
