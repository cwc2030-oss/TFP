import { NextRequest, NextResponse } from "next/server";
import { regridFetch } from "@/lib/regrid-client";
import { prisma } from "@/lib/db";
import { recordCacheHitAsync } from "@/lib/cache-stats";

export const dynamic = "force-dynamic";

// Round coordinates to ~11m grid for consistent cache keys.
function roundCoord4(val: number): number {
  return Math.round(val * 10000) / 10000;
}

interface AdjacentParcel {
  parcelId: string;
  address: string;
  owner: string;
  acreage: number;
  county: string;
  state: string;
  centroid: [number, number];
  geometry: GeoJSON.Geometry;
}

interface AdjacentResponse {
  success: boolean;
  parcels: AdjacentParcel[];
  subjectParcelId?: string;
  error?: string;
}

function calculateCentroid(geometry: GeoJSON.Geometry): [number, number] {
  let coords: number[][] = [];
  if (geometry.type === 'Polygon') {
    coords = geometry.coordinates[0] as number[][];
  } else if (geometry.type === 'MultiPolygon') {
    // Use largest ring
    let maxLen = 0;
    for (const poly of geometry.coordinates as number[][][][]) {
      if (poly[0] && poly[0].length > maxLen) {
        maxLen = poly[0].length;
        coords = poly[0];
      }
    }
  }
  if (!coords.length) return [0, 0];
  const sum = coords.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1]], [0, 0]);
  return [sum[0] / coords.length, sum[1] / coords.length];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const subjectId = searchParams.get('subjectId') || '';
  const radiusParam = searchParams.get('radius');

  if (!lat || !lng) {
    return NextResponse.json(
      { success: false, parcels: [], error: 'lat and lng required' },
      { status: 400 }
    );
  }

  const apiKey = process.env.REGRID_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, parcels: [], error: 'Regrid API key not configured' },
      { status: 500 }
    );
  }

  const radius = Math.min(Math.max(parseInt(radiusParam || '500', 10), 100), 2000);

  // ── Check adjacent cache (parcel geometry is static) ──
  const rLat = roundCoord4(parseFloat(lat));
  const rLng = roundCoord4(parseFloat(lng));
  try {
    const cached = await prisma.adjacentCache.findUnique({
      where: { lat_lng_radius: { lat: rLat, lng: rLng, radius } },
    });
    if (cached) {
      console.log(`[ADJACENT-CACHE HIT] ${rLat}, ${rLng}, r=${radius}`);
      recordCacheHitAsync('adjacent');
      const parsed = JSON.parse(cached.data) as AdjacentResponse;
      // Re-filter the subject parcel in case a different subjectId was passed
      const filtered = subjectId
        ? parsed.parcels.filter((p) => p.parcelId !== subjectId)
        : parsed.parcels;
      return NextResponse.json({
        success: true,
        parcels: filtered,
        subjectParcelId: subjectId || undefined,
        cached: true,
      });
    }
  } catch (cacheErr) {
    console.error('[ADJACENT-CACHE] Read error (non-fatal):', cacheErr);
  }

  try {
    // Regrid v2 parcels/point with radius returns GeoJSON FeatureCollection
    const url = `https://app.regrid.com/api/v2/parcels/point?lat=${lat}&lon=${lng}&radius=${radius}&limit=30&token=${apiKey}`;
    console.log('[Adjacent] Fetching:', url.replace(apiKey, '***'));

    const resp = await regridFetch(url, 'parcels-adjacent-v2', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) {
      console.error('[Adjacent] Regrid v2 error:', resp.status);
      return NextResponse.json(
        { success: false, parcels: [], error: `Regrid API error: ${resp.status}` },
        { status: 200 }
      );
    }

    const data = await resp.json();
    const features: GeoJSON.Feature[] = data?.features || [];

    console.log('[Adjacent] Got', features.length, 'features from Regrid v2');

    // Filter out the subject parcel and map to our structure
    const parcels: AdjacentParcel[] = [];
    for (const f of features) {
      const props = f.properties || {};
      const fields = props.fields || props;
      const pid = fields.parcelnumb || fields.parcelnumb_no_formatting || fields.ll_uuid || '';

      // Skip subject parcel by ID match or proximity to query point
      if (subjectId && pid && pid === subjectId) continue;

      if (!f.geometry) continue;

      const siteParts = [
        fields.address || fields.situs_address,
        fields.city || fields.situs_city,
        fields.state2 || fields.situs_state2,
      ].filter(Boolean);

      const acreage = parseFloat(fields.ll_gisacre || fields.gisacre || fields.acres || '0') || 0;

      parcels.push({
        parcelId: pid || `unknown-${parcels.length}`,
        address: siteParts.length > 0 ? siteParts.join(', ') : 'Unknown Address',
        owner: fields.owner || 'Unknown',
        acreage: Math.round(acreage * 10) / 10,
        county: fields.county || '',
        state: fields.state2 || '',
        centroid: calculateCentroid(f.geometry),
        geometry: f.geometry,
      });
    }

    console.log('[Adjacent]', parcels.length, 'adjacent parcels after filtering');

    const response: AdjacentResponse = {
      success: true,
      parcels,
      subjectParcelId: subjectId || undefined,
    };

    // ── Write to cache; re-filter subject on read for different subjectIds ──
    // Only cache successful, non-empty responses to avoid caching transient failures.
    if (parcels.length > 0) {
      prisma.adjacentCache
        .upsert({
          where: { lat_lng_radius: { lat: rLat, lng: rLng, radius } },
          update: { data: JSON.stringify({ success: true, parcels }) },
          create: { lat: rLat, lng: rLng, radius, data: JSON.stringify({ success: true, parcels }) },
        })
        .catch((err) => console.error('[ADJACENT-CACHE] Write error:', err));
    }

    return NextResponse.json(response);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Adjacent] Error:', msg);
    return NextResponse.json(
      { success: false, parcels: [], error: msg },
      { status: 200 }
    );
  }
}
