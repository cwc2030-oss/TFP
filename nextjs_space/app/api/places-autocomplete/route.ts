import { NextRequest, NextResponse } from 'next/server';

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
  
  try {
    // Use Mapbox Geocoding API (v5) — returns suggestions with place names and coordinates
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(input)}.json?access_token=${mapboxToken}&country=us&types=address,place,locality,neighborhood&limit=5&autocomplete=true`;
    
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.features && data.features.length > 0) {
      // Transform Mapbox features into a predictions-like format for the frontend
      const predictions = data.features.map((feature: any) => ({
        description: feature.place_name,
        place_id: feature.id,
        // Include coordinates directly so we don't need a separate geocode call
        lat: feature.center[1],
        lng: feature.center[0],
      }));
      return NextResponse.json({ predictions });
    } else {
      return NextResponse.json({ predictions: [] });
    }
  } catch (error) {
    console.error('Mapbox autocomplete error:', error);
    return NextResponse.json({ predictions: [] });
  }
}
