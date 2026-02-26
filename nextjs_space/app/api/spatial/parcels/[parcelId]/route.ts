/**
 * GET /api/spatial/parcels/[parcelId]
 * Returns a single parcel from Supabase spatial database
 */
import { NextRequest, NextResponse } from 'next/server';
import { spatialQuery } from '@/lib/spatial-db';

export async function GET(
  request: NextRequest,
  { params }: { params: { parcelId: string } }
) {
  try {
    const { parcelId } = params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(parcelId)) {
      return NextResponse.json(
        { error: 'Invalid parcel ID format' },
        { status: 400 }
      );
    }

    // Fetch parcel as GeoJSON Feature
    const result = await spatialQuery<{ geojson: string }>(`
      SELECT json_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(geom)::json,
        'properties', json_build_object(
          'id', id,
          'parcelId', id,
          'county', county,
          'state', state,
          'acres', acres,
          'acreage', acres,
          'source', source,
          'external_id', external_id,
          'created_at', created_at
        )
      )::text as geojson
      FROM public.parcels
      WHERE id = $1
    `, [parcelId]);

    if (!result.rows[0]?.geojson) {
      return NextResponse.json(
        { error: 'Parcel not found' },
        { status: 404 }
      );
    }

    const parcel = JSON.parse(result.rows[0].geojson);

    // Get centroid for map centering
    const centroidResult = await spatialQuery<{ lat: number; lng: number }>(`
      SELECT 
        ST_Y(ST_Centroid(geom)) as lat,
        ST_X(ST_Centroid(geom)) as lng
      FROM public.parcels
      WHERE id = $1
    `, [parcelId]);

    const centroid = centroidResult.rows[0];

    return NextResponse.json({
      parcel,
      centroid: centroid ? { lat: centroid.lat, lng: centroid.lng } : null
    });

  } catch (error) {
    console.error('[spatial/parcels] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch parcel' },
      { status: 500 }
    );
  }
}
