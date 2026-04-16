import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const input = searchParams.get('input');

  if (!input) {
    return NextResponse.json({ predictions: [] });
  }

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!mapboxToken) {
    return NextResponse.json({ error: 'Mapbox token not configured' }, { status: 500 });
  }

  const sessionToken = crypto.randomUUID();

  try {
    // Use Mapbox Search Box API v1 (suggest) — much better for rural/street addresses
    const suggestUrl = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(input)}&access_token=${mapboxToken}&country=us&limit=5&language=en&session_token=${sessionToken}&types=address,street,place`;

    const suggestRes = await fetch(suggestUrl);
    const suggestData = await suggestRes.json();

    if (!suggestData.suggestions || suggestData.suggestions.length === 0) {
      // Fallback to v5 geocoding for broader matching
      return fallbackV5Geocoding(input, mapboxToken);
    }

    // Retrieve coordinates for each suggestion in parallel
    const predictions = await Promise.all(
      suggestData.suggestions.map(async (s: any) => {
        const description = s.full_address || (s.name + (s.place_formatted ? ', ' + s.place_formatted : ''));
        const mapboxId = s.mapbox_id;

        try {
          const retrieveUrl = `https://api.mapbox.com/search/searchbox/v1/retrieve/${mapboxId}?access_token=${mapboxToken}&session_token=${sessionToken}`;
          const retrieveRes = await fetch(retrieveUrl);
          const retrieveData = await retrieveRes.json();

          if (retrieveData.features && retrieveData.features.length > 0) {
            const feature = retrieveData.features[0];
            const [lng, lat] = feature.geometry.coordinates;
            return {
              description: feature.properties.full_address || description,
              place_id: mapboxId,
              lat,
              lng,
            };
          }
        } catch {
          // If retrieve fails, return suggestion without coords
        }

        return {
          description,
          place_id: mapboxId,
          lat: undefined,
          lng: undefined,
        };
      })
    );

    return NextResponse.json({ predictions });
  } catch (error) {
    console.error('Mapbox Search Box error:', error);
    // Fallback to v5 geocoding
    return fallbackV5Geocoding(input, mapboxToken);
  }
}

async function fallbackV5Geocoding(input: string, mapboxToken: string) {
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(input)}.json?access_token=${mapboxToken}&country=us&limit=5&autocomplete=true`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.features && data.features.length > 0) {
      const predictions = data.features.map((feature: any) => ({
        description: feature.place_name,
        place_id: feature.id,
        lat: feature.center[1],
        lng: feature.center[0],
      }));
      return NextResponse.json({ predictions });
    }
    return NextResponse.json({ predictions: [] });
  } catch {
    return NextResponse.json({ predictions: [] });
  }
}
