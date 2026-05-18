import { NextRequest, NextResponse } from "next/server";
import { regridFetch } from "@/lib/regrid-client";

export const dynamic = "force-dynamic";

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
