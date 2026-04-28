import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { buildHuntingReportHtml } from '@/lib/report/build-html';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    // ── SOFT AUTH ── No session → free tier (PREVIEW watermark). Tier derived from DB when logged in.
    // Admin accounts are treated as Pro Max automatically, regardless of subscriptionStatus.
    const session = await getServerSession(authOptions);
    const serverTier = session?.user
      ? ((session.user as any).subscriptionStatus || 'free')
      : 'free';
    const serverRole = session?.user ? ((session.user as any).role || 'user') : 'guest';
    const isAdmin = serverRole === 'admin';
    const isFreePreview = !isAdmin && serverTier === 'free';

    const data = await req.json();
    const {
      address, lat, lng, acreage,
      stands, parcelCoords,
    } = data;

    // ── Report metadata ──
    const reportId = `TFP-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
    const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // ── Fetch static satellite map with parcel marker ──
    const mapToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
    const zoom = 15;
    const width = 720;
    const height = 480;

    // Build position markers for the static map (up to 3)
    const markerOverlays = stands && stands.length > 0
      ? (stands ?? []).slice(0, 3).map((s: any, i: number) => {
          const colors = ['2d6a4f', 'c9a84c', '8b4513'];
          const color = colors[i] ?? '2d6a4f';
          const lngLat = s.coords;
          if (!lngLat) return '';
          return `pin-s-s+${color}(${lngLat[0]},${lngLat[1]})`;
        }).filter(Boolean).join(',')
      : '';

    let pathOverlay = '';
    if (parcelCoords && parcelCoords.length >= 3) {
      const coords = [...parcelCoords, parcelCoords[0]];
      // Mapbox Static API path format: lon+lat pairs separated by commas
      // stroke color c9a84c, stroke width 4, opacity 1, fill opacity 0
      const pathPoints = coords
        .map((c: number[]) => `${c[0]}+${c[1]}`)
        .join(',');
      pathOverlay = `path-4+c9a84c+000000-0(${encodeURIComponent(pathPoints)})`;
      console.log('[hunt-report] path overlay length:', pathOverlay.length);
    }

    const overlayStr = [pathOverlay, markerOverlays]
      .filter(Boolean)
      .join(',') || `pin-s+2d6a4f(${lng},${lat})`;
    const mapboxBase = 'https://lh3.googleusercontent.com/xhxZWZukxLeN3jnCDOrVuhGSgsS1fLAwXwLK1UddjqyEf-aDElOsS2sWM1w4VSzdrZJxP2wohozzqTWjYpkCCW_BIe129xVAE1bZyA=e365-pa-nu-s0';
    const staticMapUrl = `${mapboxBase}/${overlayStr}/${lng},${lat},${zoom}/${width}x${height}@2x?access_token=${mapToken}`;

    console.log('[hunt-report] Static map overlay:', pathOverlay);
    console.log('[hunt-report] Full URL length:', staticMapUrl.length);
    console.log('[hunt-report] Full URL:', staticMapUrl.substring(0, 200));

    let mapImageBase64 = '';
    try {
      const mapRes = await fetch(staticMapUrl);
      console.log('[hunt-report] Static map status:', mapRes.status);
      if (mapRes.ok) {
        const mapBuffer = await mapRes.arrayBuffer();
        mapImageBase64 = `data:image/png;base64,${Buffer.from(mapBuffer).toString('base64')}`;
        console.log('[hunt-report] Static map loaded successfully');
      } else {
        console.warn('[hunt-report] Static map failed:', mapRes.status, await mapRes.text());
      }
    } catch (e) {
      console.error('[hunt-report] Static map fetch error:', e);
    }

    // ── Build HTML via extracted module ──
    const html = buildHuntingReportHtml({
      ...data,
      reportId,
      generated,
      isFreeTier: isFreePreview,
      mapImageBase64,
      origin: req.headers.get('origin') || process.env.NEXTAUTH_URL || 'https://terrafirma.partners',
    });

    // --- Convert HTML to PDF via Abacus HTML2PDF API (Playwright) ---
    console.log(`[parcel-hunt-file] Converting HTML to PDF for report ${reportId}...`);

    try {
      const createRes = await fetch('https://apps.abacus.ai/api/createConvertHtmlToPdfRequest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deployment_token: process.env.ABACUSAI_API_KEY,
          html_content: html,
          pdf_options: {
            format: 'Letter',
            print_background: true,
            margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
          },
          base_url: process.env.NEXTAUTH_URL || '',
        }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        console.error('[parcel-hunt-file] HTML2PDF create request failed:', errText);
        // Fallback to raw HTML
        return new NextResponse(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Report-ID': reportId },
        });
      }

      const { request_id } = await createRes.json();
      if (!request_id) {
        console.error('[parcel-hunt-file] HTML2PDF returned no request_id');
        return new NextResponse(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Report-ID': reportId },
        });
      }

      // Poll for completion (max ~90 seconds)
      let pdfBuffer: Buffer | null = null;
      for (let attempt = 0; attempt < 90; attempt++) {
        await new Promise(r => setTimeout(r, 1000));

        const statusRes = await fetch('https://apps.abacus.ai/api/getConvertHtmlToPdfStatus', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id, deployment_token: process.env.ABACUSAI_API_KEY }),
        });

        const statusData = await statusRes.json();
        const status = statusData?.status || 'FAILED';

        if (status === 'SUCCESS' && statusData?.result?.result) {
          pdfBuffer = Buffer.from(statusData.result.result, 'base64');
          console.log(`[parcel-hunt-file] PDF ready — ${pdfBuffer.length} bytes (attempt ${attempt + 1})`);
          break;
        } else if (status === 'FAILED') {
          console.error('[parcel-hunt-file] HTML2PDF conversion failed:', statusData?.result?.error);
          break;
        }
        // PROCESSING — keep polling
      }

      if (pdfBuffer) {
        return new NextResponse(pdfBuffer, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="TFP-Hunt-Report-${reportId}.pdf"`,
            'X-Report-ID': reportId,
          },
        });
      }

      // Fallback: return HTML if PDF conversion timed out
      console.warn('[parcel-hunt-file] PDF conversion timed out, falling back to HTML');
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Report-ID': reportId },
      });

    } catch (pdfErr: any) {
      console.error('[parcel-hunt-file] PDF conversion error:', pdfErr);
      // Graceful fallback to HTML
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Report-ID': reportId },
      });
    }

  } catch (err: any) {
    console.error('[parcel-hunt-file] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
