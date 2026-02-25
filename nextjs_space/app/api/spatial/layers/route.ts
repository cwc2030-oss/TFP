/**
 * Spatial Layers API
 * GET /api/spatial/layers
 * Returns: { parcels: FeatureCollection, corridors: FeatureCollection }
 */
import { NextResponse } from 'next/server';
import { getParcelsGeoJSON, getCorridorsGeoJSON } from '@/lib/spatial-db';

export async function GET() {
  try {
    // Fetch both layers in parallel
    const [parcels, corridors] = await Promise.all([
      getParcelsGeoJSON(),
      getCorridorsGeoJSON()
    ]);

    return NextResponse.json({
      parcels,
      corridors,
      meta: {
        parcelCount: parcels.features.length,
        corridorCount: corridors.features.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[spatial/layers] Error fetching layers:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to fetch spatial layers',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
