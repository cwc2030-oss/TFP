import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const input = searchParams.get('input');

  if (!input) {
    return NextResponse.json({ predictions: [] });
  }

  // ── Primary: Google Places Autocomplete ──
  const googleKey = process.env.GOOGLE_PLACES_API_KEY;
  if (googleKey) {
    try {
      const googleUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=geocode&components=country:us&key=${googleKey}`;
      const gRes = await fetch(googleUrl, { cache: 'no-store' });
      const gData = await gRes.json();

      if (gData.status === 'OK' && gData.predictions && gData.predictions.length > 0) {
        // Google returns predictions without coordinates — resolve via Place Details or Geocoding
        const predictions = await Promise.all(
          gData.predictions.slice(0, 5).map(async (p: any) => {
            const coords = await geocodeWithGoogle(p.description, googleKey);
            return {
              description: p.description,
              place_id: p.place_id,
              lat: coords?.lat,
              lng: coords?.lng,
            };
          })
        );
        return NextResponse.json({ predictions });
      }

      // If Google returns ZERO_RESULTS, fall through to Mapbox
      if (gData.status !== 'ZERO_RESULTS') {
        console.warn('Google Places status:', gData.status, gData.error_message || '');
      }
    } catch (err) {
      console.warn('Google Places Autocomplete failed, falling back to Mapbox:', err);
    }
  }

  // ── Fallback: Mapbox Search Box API v1 ──
  return mapboxSearchBox(input);
}

/** Geocode an address with Google Geocoding API to get lat/lng */
async function geocodeWithGoogle(address: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&components=country:US&key=${apiKey}`;
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    if (data.status === 'OK' && data.results?.length > 0) {
      const loc = data.results[0].geometry.location;
      return { lat: loc.lat, lng: loc.lng };
    }
  } catch {
    // silent — coords will be resolved on click via Mapbox fallback
  }
  return null;
}

/** Mapbox Search Box API v1 — suggest + retrieve */
async function mapboxSearchBox(input: string) {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!mapboxToken) {
    return NextResponse.json({ predictions: [] });
  }

  const sessionToken = crypto.randomUUID();

  try {
    const suggestUrl = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(input)}&access_token=${mapboxToken}&country=us&limit=5&language=en&session_token=${sessionToken}&types=address,street,place`;
    const suggestRes = await fetch(suggestUrl);
    const suggestData = await suggestRes.json();

    if (!suggestData.suggestions || suggestData.suggestions.length === 0) {
      return fallbackV5Geocoding(input, mapboxToken);
    }

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

        return { description, place_id: mapboxId, lat: undefined, lng: undefined };
      })
    );

    return NextResponse.json({ predictions });
  } catch (error) {
    console.error('Mapbox Search Box error:', error);
    return fallbackV5Geocoding(input, mapboxToken);
  }
}

/** Mapbox v5 Geocoding — last-resort fallback */
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
