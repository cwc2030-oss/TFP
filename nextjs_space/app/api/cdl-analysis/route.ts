/**
 * CDL Analysis API — USDA Cropland Data Layer edge detection
 * GET /api/cdl-analysis?bbox=minLng,minLat,maxLng,maxLat&lat=X&lng=Y&year=YYYY
 *
 * Returns: CDLAnalysisResult or { error } on failure.
 * Non-blocking: returns 200 with null-ish result if CDL service is unavailable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { analyzeCDL } from '@/lib/cdl-analysis';
import { fetchSoilData } from '@/lib/usda-soil';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bboxStr = searchParams.get('bbox');
  const lat = parseFloat(searchParams.get('lat') || '');
  const lng = parseFloat(searchParams.get('lng') || '');
  const yearStr = searchParams.get('year');
  const year = yearStr ? parseInt(yearStr, 10) : undefined;

  if (!bboxStr) {
    return NextResponse.json({ error: 'Missing bbox parameter (minLng,minLat,maxLng,maxLat)' }, { status: 400 });
  }

  const parts = bboxStr.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    return NextResponse.json({ error: 'Invalid bbox format' }, { status: 400 });
  }

  const bbox = parts as [number, number, number, number];

  // Add ~150m buffer to capture edge pixels at parcel boundary
  const BUFFER_DEG = 0.0015; // ~150m at mid-latitudes
  const bufferedBbox: [number, number, number, number] = [
    bbox[0] - BUFFER_DEG,
    bbox[1] - BUFFER_DEG,
    bbox[2] + BUFFER_DEG,
    bbox[3] + BUFFER_DEG,
  ];

  try {
    // Fetch soil drainage class for cross-referencing
    let drainageClass = 'Unknown';
    if (!isNaN(lat) && !isNaN(lng)) {
      try {
        const soilData = await fetchSoilData(lat, lng);
        drainageClass = soilData.drainageClass;
        console.log(`[CDL-API] Soil drainage: ${drainageClass}`);
      } catch (soilErr) {
        console.warn('[CDL-API] Soil fetch failed (non-blocking):', (soilErr as Error).message);
      }
    }

    const result = await analyzeCDL(bufferedBbox, drainageClass, year);

    if (!result) {
      // CDL service unavailable — return empty result, not an error
      return NextResponse.json({
        agEdgeLines: { type: 'FeatureCollection', features: [] },
        insideCorners: { type: 'FeatureCollection', features: [] },
        soilFlags: { drainageClass, bedding_candidate: false, travel_corridor: false },
        metadata: { year: year || new Date().getFullYear() - 1, totalPixels: 0, agPixels: 0, timberPixels: 0, edgeSegments: 0, cornerCount: 0, resolution: 30 },
      });
    }

    console.log(`[CDL-API] Success: ${result.agEdgeLines.features.length} edge lines, ${result.insideCorners.features.length} corners, soil=${drainageClass}`);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[CDL-API] Unexpected error:', err);
    // Non-blocking: return empty result
    return NextResponse.json({
      agEdgeLines: { type: 'FeatureCollection', features: [] },
      insideCorners: { type: 'FeatureCollection', features: [] },
      soilFlags: { drainageClass: 'Unknown', bedding_candidate: false, travel_corridor: false },
      metadata: { year: year || new Date().getFullYear() - 1, totalPixels: 0, agPixels: 0, timberPixels: 0, edgeSegments: 0, cornerCount: 0, resolution: 30 },
    });
  }
}
