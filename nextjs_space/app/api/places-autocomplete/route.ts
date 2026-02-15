import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const input = searchParams.get('input');
  
  if (!input) {
    return NextResponse.json({ predictions: [] });
  }
  
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }
  
  try {
    // Use Google Places Autocomplete API
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=address&components=country:us&key=${apiKey}`;
    
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.status === 'OK' || data.status === 'ZERO_RESULTS') {
      return NextResponse.json({
        predictions: data.predictions || []
      });
    } else {
      console.error('Places API error:', data.status, data.error_message);
      return NextResponse.json({ predictions: [] });
    }
  } catch (error) {
    console.error('Places autocomplete error:', error);
    return NextResponse.json({ predictions: [] });
  }
}
