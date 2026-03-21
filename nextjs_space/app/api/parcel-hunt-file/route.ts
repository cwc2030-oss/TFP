import { NextRequest, NextResponse } from 'next/server';

const seasonLabel = (s: string) =>
  s === 'early' ? 'Early Season' : s === 'rut' ? 'Rut Season' : 'Late Season';

const scoreColor = (s: number) =>
  s >= 70 ? '#2d6a4f' : s >= 40 ? '#d4a017' : '#c0392b';

const scoreLabel = (s: number) =>
  s >= 70 ? 'PRIME' : s >= 40 ? 'HUNTABLE' : 'MARGINAL';

const riskColor = (r: string) =>
  r === 'low' ? '#2d6a4f' : r === 'medium' ? '#d4a017' : '#c0392b';

const css = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, serif; color: #1a1a1a; background: white; }
  .page { width: 816px; min-height: 1056px; padding: 48px; position: relative; page-break-after: always; }
  .border { border: 3px solid #1a3a2a; }
  .header { background: #1a3a2a; color: white; padding: 20px 32px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; }
  .header h1 { font-size: 22px; letter-spacing: 2px; }
  .header p { font-size: 11px; opacity: 0.8; margin-top: 4px; }
  .gold-bar { height: 3px; background: linear-gradient(90deg, #c9a84c, #f0d080, #c9a84c); margin-bottom: 24px; }
  .section-title { background: #1a3a2a; color: white; padding: 10px 16px; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 16px; }
  .score-hero { text-align: center; padding: 32px; background: #f8f6f0; border: 2px solid #1a3a2a; margin-bottom: 24px; }
  .big-score { font-size: 72px; font-weight: bold; line-height: 1; }
  .score-sub { font-size: 12px; color: #666; margin-top: 8px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .stat-box { background: #f8f6f0; border: 1px solid #ddd; padding: 16px; text-align: center; }
  .stat-value { font-size: 28px; font-weight: bold; color: #1a3a2a; }
  .stat-label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .stand-card { border: 2px solid #1a3a2a; margin-bottom: 16px; }
  .stand-header { padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; }
  .stand-rank { font-size: 24px; font-weight: bold; color: #c9a84c; margin-right: 12px; }
  .stand-name { font-size: 16px; font-weight: bold; }
  .stand-tier { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; opacity: 0.8; }
  .stand-score-badge { padding: 8px 16px; font-size: 20px; font-weight: bold; color: white; min-width: 80px; text-align: center; }
  .stand-body { padding: 16px; border-top: 1px solid #ddd; background: #f8f6f0; }
  .stand-reasoning { font-size: 12px; line-height: 1.6; color: #333; margin-bottom: 12px; font-style: italic; }
  .stand-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .stand-stat { text-align: center; background: white; padding: 8px; border: 1px solid #ddd; }
  .stand-stat-val { font-size: 14px; font-weight: bold; }
  .stand-stat-key { font-size: 9px; text-transform: uppercase; color: #666; }
  .wind-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .wind-tag { padding: 3px 8px; font-size: 10px; border-radius: 2px; font-weight: bold; }
  .wind-good { background: #d4edda; color: #155724; }
  .wind-bad { background: #f8d7da; color: #721c24; }
  .season-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; border: 2px solid #1a3a2a; margin-bottom: 24px; }
  .season-cell { padding: 20px; text-align: center; border-right: 1px solid #ddd; }
  .season-cell:last-child { border-right: none; }
  .season-recommended { background: #1a3a2a; color: white; }
  .season-name { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .corridor-bar { height: 12px; background: #e0e0e0; border-radius: 2px; margin-top: 4px; }
  .corridor-fill { height: 100%; background: #1a3a2a; border-radius: 2px; }
  .footer { position: absolute; bottom: 24px; left: 48px; right: 48px; display: flex; justify-content: space-between; font-size: 10px; color: #999; border-top: 1px solid #ddd; padding-top: 8px; }
  .disclaimer { font-size: 9px; color: #999; line-height: 1.5; margin-top: 16px; padding-top: 12px; border-top: 1px solid #eee; }
`;

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const {
      address, lat, lng, acreage, county, state,
      prevailingWind, stands, summary, corridors, seasonScores
    } = data;

    const reportId = `TFP-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
    const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Better county/state parsing from full address string
    // e.g. "437 SE State Hwy Pp, Leeton, Johnson County, MO 64761, USA"
    const addressParts = (address ?? '').split(',').map((s: string) => s.trim());
    const parsedCounty = addressParts
      .find((p: string) => p.toLowerCase().includes('county'))
      ?.replace(/county/i, '').trim() ?? county ?? '';
    const parsedState = addressParts
      .find((p: string) => /\b[A-Z]{2}\b/.test(p))
      ?.match(/\b[A-Z]{2}\b/)?.[0] ?? state ?? 'MO';

    // Fetch static satellite map with parcel marker
    const mapToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
    const zoom = 14;
    const width = 720;
    const height = 480;

    // Build stand markers for the static map (up to 3)
    const markerOverlays = (stands ?? []).slice(0, 3).map((s: any, i: number) => {
      const colors = ['2d6a4f', 'c9a84c', '8b4513'];
      const color = colors[i] ?? '2d6a4f';
      const lngLat = s.coords;
      if (!lngLat) return '';
      return `pin-s-s+${color}(${lngLat[0]},${lngLat[1]})`;
    }).filter(Boolean).join(',');

    const overlayStr = markerOverlays || 'pin-s+2d6a4f(' + lng + ',' + lat + ')';
    const mapboxBase = 'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static';
    const staticMapUrl = `${mapboxBase}/${overlayStr}/${lng},${lat},${zoom}/${width}x${height}@2x?access_token=${mapToken}`;

    let mapImageBase64 = '';
    try {
      const mapRes = await fetch(staticMapUrl);
      if (mapRes.ok) {
        const mapBuffer = await mapRes.arrayBuffer();
        mapImageBase64 = `data:image/png;base64,${Buffer.from(mapBuffer).toString('base64')}`;
      }
    } catch (e) {
      console.warn('[hunt-report] Static map fetch failed:', e);
    }

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${css}</style>
</head>
<body>

<div class="page border">
  <div class="header">
    <div><h1>TERRA FIRMA PARTNERS</h1><p>Terrain Intelligence for Landowners</p></div>
    <div style="text-align:right;font-size:11px;opacity:0.8">
      <div>Report ID: ${reportId}</div><div>Generated: ${generated}</div>
    </div>
  </div>
  <div style="text-align:center;margin-bottom:24px">
    <div style="font-size:28px;font-weight:bold;letter-spacing:2px;color:#1a3a2a">HUNTING INTELLIGENCE REPORT</div>
    <div style="font-size:13px;color:#666;margin-top:6px">${address}</div>
    <div style="font-size:12px;color:#999;margin-top:4px">${acreage} Acres | ${parsedCounty} County, ${parsedState}</div>
  </div>
  <div class="gold-bar"></div>
  <div class="score-hero">
    <div style="font-size:13px;text-transform:uppercase;letter-spacing:2px;color:#666;margin-bottom:8px">Overall Huntability Score</div>
    <div class="big-score" style="color:${scoreColor(summary?.topStandScore ?? 0)}">${summary?.topStandScore ?? 0}</div>
    <div style="font-size:18px;letter-spacing:3px;margin-top:8px;color:${scoreColor(summary?.topStandScore ?? 0)}">${scoreLabel(summary?.topStandScore ?? 0)}</div>
    <div class="score-sub">Based on terrain analysis, corridor strength, bedding proximity, and wind alignment</div>
  </div>
  <div class="grid-3">
    <div class="stat-box">
      <div class="stat-value">${summary?.totalBeddingAcres?.toFixed(1) ?? '0'}</div>
      <div class="stat-label">Bedding Acres</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${corridors?.primaryCount ?? 0}</div>
      <div class="stat-label">Primary Corridors</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${summary?.funnelCount ?? 0}</div>
      <div class="stat-label">Funnel Zones</div>
    </div>
  </div>
  <div class="section-title">Seasonal Huntability</div>
  <div class="season-grid">
    ${['early','rut','late'].map((s: string) => `
    <div class="season-cell ${s === seasonScores?.recommended ? 'season-recommended' : ''}">
      <div class="season-name">${seasonLabel(s)}</div>
      ${s === seasonScores?.recommended
        ? `<div style="font-size:24px;font-weight:bold;margin:8px 0">${seasonScores?.topScore ?? 0}</div>
           <div style="display:inline-block;padding:4px 12px;font-size:11px;background:#c9a84c;color:#1a3a2a">★ RECOMMENDED</div>`
        : `<div style="font-size:13px;margin:8px 0;color:#666">Run season analysis</div>
           <div style="display:inline-block;padding:4px 12px;font-size:11px;background:#e0e0e0;color:#666">SELECT SEASON</div>`
      }
    </div>`).join('')}
  </div>
  <div class="grid-2">
    <div class="stat-box">
      <div class="stat-value">${summary?.analysisAreaAcres?.toFixed(0) ?? '0'}</div>
      <div class="stat-label">Analysis Area (Acres)</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${summary?.elevRange ? Math.round(summary.elevRange * 3.281) : 0} ft</div>
      <div class="stat-label">Elevation Range</div>
    </div>
  </div>
  <div class="footer">
    <span>Report ID: ${reportId}</span>
    <span>TERRA FIRMA PARTNERS</span>
    <span>Page 1 of 2</span>
  </div>
</div>

<div class="page border">
  <div class="header">
    <div><h1>TERRA FIRMA PARTNERS</h1><p>Terrain Intelligence for Landowners</p></div>
    <div style="text-align:right;font-size:11px;opacity:0.8">
      <div>Report ID: ${reportId}</div>
      <div>Prevailing Wind: ${prevailingWind ?? 'Not Set'}</div>
    </div>
  </div>
  <div style="text-align:center;margin-bottom:24px">
    <div style="font-size:22px;font-weight:bold;letter-spacing:2px;color:#1a3a2a">STAND PLACEMENT ANALYSIS</div>
    <div style="font-size:12px;color:#666;margin-top:6px">Top recommended stand locations based on terrain, wind, and deer movement intelligence</div>
  </div>
  <div class="gold-bar"></div>
  ${(stands ?? []).map((stand: any, i: number) => `
  <div class="stand-card">
    <div class="stand-header" style="background:${i === 0 ? '#1a3a2a' : '#f8f6f0'};color:${i === 0 ? 'white' : '#1a1a1a'}">
      <div style="display:flex;align-items:center">
        <div class="stand-rank">#${stand.rank}</div>
        <div>
          <div class="stand-name">${stand.name}</div>
          <div class="stand-tier">${stand.tier} · ${stand.resilience}</div>
        </div>
      </div>
      <div class="stand-score-badge" style="background:${scoreColor(stand.score)}">${stand.score}</div>
    </div>
    <div class="stand-body">
      <div class="stand-reasoning">"${stand.reasoning}"</div>
      <div class="stand-stats">
        <div class="stand-stat">
          <div class="stand-stat-val" style="color:${riskColor(stand.approachRisk)}">${(stand.approachRisk ?? 'med').toUpperCase()}</div>
          <div class="stand-stat-key">Approach Risk</div>
        </div>
        <div class="stand-stat">
          <div class="stand-stat-val">${stand.distToCorridorM ? Math.round(stand.distToCorridorM) : '—'}m</div>
          <div class="stand-stat-key">To Corridor</div>
        </div>
        <div class="stand-stat">
          <div class="stand-stat-val">${stand.distToBeddingM ? Math.round(stand.distToBeddingM) : '—'}m</div>
          <div class="stand-stat-key">To Bedding</div>
        </div>
        <div class="stand-stat">
          <div class="stand-stat-val">${stand.elevation ? Math.round(stand.elevation * 3.281) : '—'}ft</div>
          <div class="stand-stat-key">Elevation</div>
        </div>
      </div>
      <div style="margin-top:12px">
        <div style="font-size:10px;text-transform:uppercase;color:#666;margin-bottom:4px">Wind Alignment</div>
        <div class="wind-row">
          ${(stand.windOk ?? []).map((w: string) => `<span class="wind-tag wind-good">✓ ${w}</span>`).join('')}
          ${(stand.windBad ?? []).map((w: string) => `<span class="wind-tag wind-bad">✗ ${w}</span>`).join('')}
        </div>
      </div>
    </div>
  </div>`).join('')}
  <div class="section-title" style="margin-top:16px">Corridor Intelligence</div>
  <div class="grid-2">
    <div class="stat-box">
      <div class="stat-value">${corridors?.primaryCount ?? 0} primary · ${corridors?.possibleCount ?? 0} possible</div>
      <div class="stat-label">Movement Corridors Detected</div>
      <div class="corridor-bar">
        <div class="corridor-fill" style="width:${Math.min(100, (corridors?.parcelCoverage ?? 0) * 100)}%"></div>
      </div>
      <div style="font-size:10px;color:#666;margin-top:4px">${((corridors?.parcelCoverage ?? 0) * 100).toFixed(0)}% parcel corridor coverage</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${corridors?.hardFunnelCount ?? 0} hard · ${corridors?.slightFunnelCount ?? 0} slight</div>
      <div class="stat-label">Funnel Zones Detected</div>
      <div style="font-size:11px;color:#1a3a2a;margin-top:8px;font-weight:bold">
        ${(corridors?.hardFunnelCount ?? 0) > 0 ? '★ Hard funnels present — high value stand locations' : 'Soft funnels only — terrain dependent movement'}
      </div>
    </div>
  </div>
  <div class="disclaimer">
    This report is generated from satellite terrain analysis and predictive modeling. Stand placement recommendations are based on terrain geometry,
    historical deer movement patterns, and wind modeling. Always scout properties in person before placing permanent stands.
    Terra Firma Partners is not responsible for hunting outcomes. Data sources: Regrid, USGS DEM, USDA. Report ID: ${reportId}
  </div>
  <div class="footer">
    <span>Report ID: ${reportId}</span>
    <span>TERRA FIRMA PARTNERS</span>
    <span>Page 2 of ${mapImageBase64 ? '3' : '2'}</span>
  </div>
</div>

${mapImageBase64 ? `
<div class="page border">
  <div class="header">
    <div><h1>TERRA FIRMA PARTNERS</h1><p>Terrain Intelligence for Landowners</p></div>
    <div style="text-align:right;font-size:11px;opacity:0.8">
      <div>Report ID: ${reportId}</div>
      <div>Generated: ${generated}</div>
    </div>
  </div>

  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:22px;font-weight:bold;letter-spacing:2px;color:#1a3a2a">TERRAIN HUNT MAP</div>
    <div style="font-size:12px;color:#666;margin-top:6px">${address}</div>
  </div>

  <div class="gold-bar"></div>

  <div style="border:3px solid #1a3a2a;margin-bottom:20px;position:relative">
    <img src="${mapImageBase64}" style="width:100%;display:block" alt="Terrain Hunt Map"/>
    <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(26,58,42,0.85);padding:8px 12px;display:flex;gap:24px;align-items:center">
      <span style="color:white;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:bold">Legend:</span>
      <span style="color:white;font-size:10px">🟢 #1 Stand — ${stands?.[0]?.name ?? 'Top Stand'}</span>
      ${stands?.[1] ? `<span style="color:white;font-size:10px">🟡 #2 Stand — ${stands[1].name}</span>` : ''}
      ${stands?.[2] ? `<span style="color:white;font-size:10px">🟤 #3 Stand — ${stands[2].name}</span>` : ''}
    </div>
  </div>

  <div class="section-title">Stand Location Summary</div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
    ${(stands ?? []).slice(0,3).map((s: any, i: number) => `
    <div style="border:2px solid #1a3a2a;padding:12px;background:#f8f6f0">
      <div style="font-size:11px;font-weight:bold;color:#c9a84c;margin-bottom:4px">#${s.rank} — ${s.name}</div>
      <div style="font-size:10px;color:#666;margin-bottom:6px">${s.tier}</div>
      <div style="font-size:18px;font-weight:bold;color:#1a3a2a;margin-bottom:6px">${s.score}</div>
      <div style="font-size:10px;color:#333">${s.coords ? `${s.coords[1].toFixed(5)}°N ${Math.abs(s.coords[0]).toFixed(5)}°W` : 'Coords unavailable'}</div>
      <div style="font-size:10px;color:#666;margin-top:4px">Elevation: ${s.elevation ? Math.round(s.elevation * 3.281) : '—'}ft</div>
    </div>`).join('')}
  </div>

  <div class="section-title">Approach & Wind Strategy</div>
  <div style="background:#f8f6f0;border:1px solid #ddd;padding:16px;margin-bottom:16px">
    <div style="font-size:12px;color:#333;line-height:1.8">
      <div style="margin-bottom:8px"><strong>Prevailing Wind:</strong> ${prevailingWind ?? 'Not set'} — plan entry routes to keep wind in your favor approaching each stand.</div>
      <div style="margin-bottom:8px"><strong>Top Stand (${stands?.[0]?.name ?? '—'}):</strong> Best hunted on ${(stands?.[0]?.windOk ?? []).join(', ') || 'any'} winds. Approach risk: ${stands?.[0]?.approachRisk ?? '—'}.</div>
      ${stands?.[1] ? `<div style="margin-bottom:8px"><strong>Stand 2 (${stands[1].name}):</strong> Best hunted on ${(stands[1].windOk ?? []).join(', ') || 'any'} winds. Approach risk: ${stands[1].approachRisk ?? '—'}.</div>` : ''}
      ${stands?.[2] ? `<div><strong>Stand 3 (${stands[2].name}):</strong> Best hunted on ${(stands[2].windOk ?? []).join(', ') || 'any'} winds. Approach risk: ${stands[2].approachRisk ?? '—'}.</div>` : ''}
    </div>
  </div>

  <div style="background:#1a3a2a;color:white;padding:12px 16px;font-size:11px;line-height:1.6">
    <strong>PRO TIP:</strong> Always approach stands from downwind. Check wind forecast the night before and select the stand whose good wind directions match tomorrow's forecast. 
    Deer will smell you from 300+ yards — your entry route matters as much as your stand location.
  </div>

  <div class="footer">
    <span>Report ID: ${reportId}</span>
    <span>TERRA FIRMA PARTNERS</span>
    <span>Page 3 of 3</span>
  </div>
</div>
` : ''}

</body>
</html>`;

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