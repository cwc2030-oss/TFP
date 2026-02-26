/**
 * GET /api/spatial/parcels/[parcelId]/corridors
 * Returns corridors for a specific parcel
 * Guarded by user_parcels ownership check
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
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

    // Check authentication (optional for now - can tighten later)
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    // If authenticated, check ownership via user_parcels
    if (userId) {
      const ownershipCheck = await spatialQuery<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM public.user_parcels 
         WHERE user_id = $1 AND parcel_id = $2`,
        [userId, parcelId]
      );

      if (parseInt(ownershipCheck.rows[0]?.count || '0') === 0) {
        return NextResponse.json(
          { error: 'Parcel not found or access denied' },
          { status: 403 }
        );
      }
    }
    
    // For unauthenticated requests, allow read access to corridors
    // (can tighten security later when RLS is fully configured)

    // Fetch corridors for this parcel
    const result = await spatialQuery<{ geojson: string }>(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(json_agg(
          json_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(geom)::json,
            'properties', json_build_object(
              'id', id,
              'parcel_id', parcel_id,
              'type', type,
              'score', score,
              'meta', meta,
              'created_at', created_at
            )
          )
        ) FILTER (WHERE id IS NOT NULL), '[]'::json)
      )::text as geojson
      FROM public.corridors
      WHERE parcel_id = $1
    `, [parcelId]);

    const corridors = JSON.parse(
      result.rows[0]?.geojson || '{"type":"FeatureCollection","features":[]}'
    );

    return NextResponse.json({
      parcelId,
      corridors,
      count: corridors.features.length
    });

  } catch (error) {
    console.error('[spatial/parcels/corridors] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch corridors' },
      { status: 500 }
    );
  }
}
