import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const {
      address, lat, lng, acreage, county, state,
      prevailingWind, stands, summary, corridors, seasonScores
    } = data;

    const reportId = `TFP-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
    const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // HTML will be added next
    const html = `<html><body><h1>TFP Report ${reportId}</h1></body></html>`;

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Report-ID': reportId,
      }
    });

  } catch (err: any) {
    console.error('[parcel-hunt-file] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
