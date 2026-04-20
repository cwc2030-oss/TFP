import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

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
  /* Page 1 density overrides — tightens vertical spacing so all content fits cleanly on one page. */
  .page-1 .header { margin-bottom: 20px; }
  .page-1 .gold-bar { margin-bottom: 14px; }
  .page-1 .score-hero { padding: 20px; margin-bottom: 14px; }
  .page-1 .big-score { font-size: 60px; }
  .page-1 .score-sub { margin-top: 4px; }
  .page-1 .grid-3 { margin-bottom: 14px; }
  .page-1 .stat-box { padding: 10px; }
  .page-1 .stat-value { font-size: 22px; }
  .page-1 .stat-label { margin-top: 2px; }
  .page-1 .section-title { margin-bottom: 10px; padding: 8px 16px; }
  .page-1 .season-grid { margin-bottom: 14px; }
  .page-1 .season-cell { padding: 14px; }
  /* Free-tier PREVIEW watermark — injected conditionally */
  .preview-watermark::after {
    content: 'PREVIEW';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 120px;
    font-weight: bold;
    color: rgba(0, 0, 0, 0.06);
    letter-spacing: 16px;
    pointer-events: none;
    z-index: 9999;
    white-space: nowrap;
    font-family: Arial, Helvetica, sans-serif;
  }
`;

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const {
      address, lat, lng, acreage, county, state,
      prevailingWind, stands, summary, corridors, seasonScores, parcelCoords,
      terrainHeadline, terrainNarrative, terrainDriver, terrainConfidence, elevRange,
      isTerritory = false,
      territoryName = 'My Territory',
      territoryParcelCount = 1,
      territoryParcels: territoryParcelList = null,
      tier = 'free',
    } = data;
    const isFreePreview = tier === 'free';

    // Derive elevation range from stand elevations if demMetrics unavailable
    const standElevations = (stands ?? [])
      .map((s: any) => s.elevation ? Math.round(s.elevation * 3.281) : 0)
      .filter((e: number) => e > 0);
    const computedElevRange = standElevations.length >= 2
      ? Math.round(Math.max(...standElevations) - Math.min(...standElevations))
      : 0;
    const displayElevRange = elevRange > 0 ? elevRange : computedElevRange;
    const displayElevMin = standElevations.length ? Math.round(Math.min(...standElevations)) : 0;
    const displayElevMax = standElevations.length ? Math.round(Math.max(...standElevations)) : 0;
    const displayElevAvg = standElevations.length 
      ? Math.round(standElevations.reduce((a: number, b: number) => a + b, 0) / standElevations.length)
      : 0;

    const reportId = `TFP-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
    const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const wm = isFreePreview ? ' preview-watermark' : '';

    // Lease Intelligence computed variables
    const leaseValuePerAcre = (summary?.topStandScore ?? 0) >= 80 ? '$18-25' 
      : (summary?.topStandScore ?? 0) >= 60 ? '$12-18' 
      : (summary?.topStandScore ?? 0) >= 40 ? '$8-12' 
      : '$4-8';

    const certifiedBadge = (summary?.topStandScore ?? 0) >= 70 
      ? `<div style="background:#1a3a2a;color:#c9a84c;padding:8px 20px;font-size:11px;letter-spacing:3px;font-weight:bold;display:inline-block">&#10003; CERTIFIED HUNTABLE</div>`
      : (summary?.topStandScore ?? 0) >= 40
      ? `<div style="background:#8b6f47;color:white;padding:8px 20px;font-size:11px;letter-spacing:3px;font-weight:bold;display:inline-block">&#9680; CONDITIONALLY HUNTABLE</div>`
      : `<div style="background:#8b0000;color:white;padding:8px 20px;font-size:11px;letter-spacing:3px;font-weight:bold;display:inline-block">&#10007; LIMITED HUNTABILITY</div>`;

    const carryingCapacity = Math.max(1, Math.round((acreage ?? 40) / 40));
    const standInventory = (stands ?? []).length;

    const leaseIntelHTML = `
<div style="border:2px solid #c9a84c;padding:12px 14px;margin-bottom:14px;background:#fdf9f0">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <div style="font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#1a3a2a">Lease Intelligence</div>
    ${certifiedBadge}
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:8px">
    <div style="text-align:center;background:white;border:1px solid #ddd;padding:10px">
      <div style="font-size:20px;font-weight:bold;color:#1a3a2a">${leaseValuePerAcre}</div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-top:2px">Est. Lease / Acre / Yr</div>
    </div>
    <div style="text-align:center;background:white;border:1px solid #ddd;padding:10px">
      <div style="font-size:20px;font-weight:bold;color:#1a3a2a">${standInventory}</div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-top:2px">Prime Intercept Points</div>
    </div>
    <div style="text-align:center;background:white;border:1px solid #ddd;padding:10px">
      <div style="font-size:20px;font-weight:bold;color:#1a3a2a">${carryingCapacity}</div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-top:2px">Est. Hunters Supported</div>
    </div>
    <div style="text-align:center;background:white;border:1px solid #ddd;padding:10px">
      <div style="font-size:20px;font-weight:bold;color:#1a3a2a">${Math.round(corridors?.parcelCoverage || 0)}%</div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-top:2px">Corridor Coverage</div>
    </div>
  </div>
  <div style="background:#f0ede4;padding:7px 12px;border-left:3px solid #c9a84c;font-size:11px;color:#555;line-height:1.45">
    <strong>Note:</strong> Deer movement does not stop at property lines. Adjacent parcel analysis available 
    at terrafirma.partners to complete the full terrain picture for larger hunting operations.
  </div>
  <div style="margin-top:6px;font-size:10px;color:#aaa;font-style:italic;line-height:1.3">
    Lease value estimates based on Missouri/Kansas regional averages and terrain huntability scoring. Actual rates vary by location, access, and amenities.
  </div>
</div>`;

    const dualAudienceHTML = `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:2px solid #1a3a2a;margin-bottom:14px">
  <div style="padding:12px 14px;border-right:1px solid #1a3a2a">
    <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-bottom:4px">For the Landowner</div>
    <div style="font-size:13px;font-weight:bold;color:#1a3a2a;margin-bottom:4px">Lease With Confidence</div>
    <div style="font-size:11px;color:#444;line-height:1.5">This terrain assessment certifies the hunting quality of your property using satellite intelligence. Share this report with prospective lessees to justify premium lease rates and attract serious hunters who understand land quality.</div>
  </div>
  <div style="padding:12px 14px;background:#f8f6f0">
    <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-bottom:4px">For the Hunter</div>
    <div style="font-size:13px;font-weight:bold;color:#1a3a2a;margin-bottom:4px">Hunt With Intelligence</div>
    <div style="font-size:11px;color:#444;line-height:1.5">Your terrain analysis identifies exactly where deer move, bed, and converge on this property. Use the intercept points and wind strategy in this report to put yourself in the right position before opening day.</div>
  </div>
</div>`;

    // Hunt Certificate computed variables
    const huntGrade = (summary?.topStandScore ?? 0) >= 90 ? 'A+' 
      : (summary?.topStandScore ?? 0) >= 80 ? 'A' 
      : (summary?.topStandScore ?? 0) >= 70 ? 'B' 
      : (summary?.topStandScore ?? 0) >= 60 ? 'C' 
      : 'D';

    const gradeColor = (summary?.topStandScore ?? 0) >= 70 ? '#1a3a2a' 
      : (summary?.topStandScore ?? 0) >= 50 ? '#8b6f47' 
      : '#8b0000';

    const certificateTitle = isTerritory
      ? `TERRITORY HUNT CERTIFICATE`
      : `TERRAIN HUNT CERTIFICATE`;

    const territorySection = isTerritory && territoryParcelList ? `
<div style="margin-bottom:20px;text-align:left">
  <div style="font-size:10px;font-weight:bold;color:#1a3a2a;margin-bottom:8px;letter-spacing:2px">
    TERRITORY PARCELS
  </div>
  ${(territoryParcelList as any[]).map((p: any, i: number) => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;font-size:11px">
      <span style="color:#333">Parcel ${i + 1} — ${(p.address || '').split(',')[0]}</span>
      <span style="color:#1a3a2a;font-weight:bold">${p.acreage} ac</span>
    </div>
  `).join('')}
  <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:12px;font-weight:bold">
    <span style="color:#1a3a2a">Total Territory</span>
    <span style="color:#c9a84c">${Math.round(acreage)} acres across ${territoryParcelCount} parcels</span>
  </div>
</div>` : '';

    const certificatePage = `
<div class="page border${wm}">
  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:900px;text-align:center;padding:48px">
    <div style="font-size:11px;letter-spacing:4px;color:#888;text-transform:uppercase;margin-bottom:24px">Terra Firma Partners — Official Terrain Assessment</div>
    <div style="border:3px solid #c9a84c;padding:48px 64px;width:100%;max-width:600px">
      <div style="font-size:13px;letter-spacing:3px;color:#666;margin-bottom:8px">${certificateTitle}</div>
      <div style="height:2px;background:linear-gradient(90deg,#c9a84c,#f0d080,#c9a84c);margin-bottom:32px"></div>
      <div style="font-size:96px;font-weight:bold;color:${gradeColor};line-height:1;margin-bottom:8px">${huntGrade}</div>
      <div style="font-size:13px;letter-spacing:2px;color:#666;margin-bottom:32px">HUNTABILITY GRADE</div>
      <div style="background:#f8f6f0;padding:20px;margin-bottom:24px;text-align:left">
        <div style="font-size:12px;font-weight:bold;color:#1a3a2a;margin-bottom:8px;letter-spacing:1px">PROPERTY</div>
        <div style="font-size:14px;color:#333;margin-bottom:4px">${address}</div>
        <div style="font-size:12px;color:#666">${Math.round(acreage ?? 40)} Acres | ${county || 'Missouri'} County, ${state || 'MO'}</div>
      </div>
      ${territorySection}
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px">
        <div style="background:#1a3a2a;color:white;padding:12px">
          <div style="font-size:20px;font-weight:bold;color:#c9a84c">${summary?.topStandScore ?? 0}</div>
          <div style="font-size:9px;letter-spacing:1px;opacity:0.8;margin-top:4px">HUNTABILITY SCORE</div>
        </div>
        <div style="background:#1a3a2a;color:white;padding:12px">
          <div style="font-size:20px;font-weight:bold;color:#c9a84c">${(stands ?? []).length}</div>
          <div style="font-size:9px;letter-spacing:1px;opacity:0.8;margin-top:4px">INTERCEPT POINTS</div>
        </div>
        <div style="background:#1a3a2a;color:white;padding:12px">
          <div style="font-size:20px;font-weight:bold;color:#c9a84c">${corridors?.primaryCount || 0}</div>
          <div style="font-size:9px;letter-spacing:1px;opacity:0.8;margin-top:4px">CORRIDORS</div>
        </div>
      </div>
      <div style="height:1px;background:#ddd;margin-bottom:16px"></div>
      <div style="font-size:10px;color:#999;line-height:1.6;margin-bottom:16px">
        This certificate confirms that the above property has been analyzed using satellite terrain 
        intelligence, elevation modeling, and deer movement prediction. 
        Assessment valid at time of generation. Adjacent parcel analysis available separately.
      </div>
      <div style="padding-top:16px;border-top:1px solid #ddd">
        <div style="font-size:11px;font-weight:bold;color:#1a3a2a;letter-spacing:1px">TERRA FIRMA PARTNERS</div>
        <div style="font-size:10px;color:#888">terrafirma.partners | Terrain Intelligence for Serious Hunters</div>
      </div>
    </div>
    <div style="margin-top:24px;font-size:10px;color:#ccc;letter-spacing:2px">Report ID: ${reportId}</div>
  </div>
  <div class="footer">
    <span>Report ID: ${reportId}</span>
    <span>TERRA FIRMA PARTNERS</span>
    <span>Certificate of Terrain Analysis</span>
  </div>
</div>`;

    // Better county/state parsing from full address string
    // Google format: "425 SE 850th Rd, Leeton, MO 64761, USA"
    // Regrid format: "425 SE 850TH RD, LEETON, MO 64761"
    const addressParts = (address ?? '').split(',').map((s: string) => s.trim());
    const parsedCounty = addressParts
      .find((p: string) => p.toLowerCase().includes('county'))
      ?.replace(/county/i, '').trim() ?? county ?? '';
    // Match state as 2-letter code immediately before a 5-digit ZIP to avoid
    // matching directional abbreviations like "SE" in street names
    const stateZipMatch = (address ?? '').match(/\b([A-Z]{2})\s+\d{5}\b/);
    const parsedState = stateZipMatch?.[1] ?? state ?? 'MO';

    // Fetch static satellite map with parcel marker
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
    const mapboxBase = 'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static';
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

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${css}</style>
</head>
<body>

<div class="page page-1 border${wm}">
  <div class="header">
    <div><h1>TERRA FIRMA PARTNERS</h1><p>Terrain Intelligence for Landowners</p></div>
    <div style="text-align:right;font-size:11px;opacity:0.8">
      <div>Report ID: ${reportId}</div><div>Generated: ${generated}</div>
    </div>
  </div>
  <div style="text-align:center;margin-bottom:14px">
    <div style="font-size:26px;font-weight:bold;letter-spacing:2px;color:#1a3a2a">${isTerritory ? 'TERRITORY INTELLIGENCE REPORT' : 'HUNTING INTELLIGENCE REPORT'}</div>
    <div style="font-size:13px;color:#666;margin-top:4px">${isTerritory ? `${territoryName} — ${territoryParcelCount} parcels — ${Math.round(acreage)} total acres` : address}</div>
    <div style="font-size:12px;color:#999;margin-top:2px">${acreage} Acres | ${parsedCounty} County, ${parsedState}</div>
  </div>
  <div class="gold-bar"></div>
  ${terrainNarrative ? `
<div style="background:#f8f6f0;border-left:4px solid #c9a84c;padding:12px 16px;margin-bottom:14px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
    <div style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#1a3a2a">
      Terrain Character
    </div>
    ${terrainConfidence ? `<span style="background:#1a3a2a;color:white;padding:2px 8px;font-size:9px;letter-spacing:1px">${terrainConfidence.toUpperCase()} CONFIDENCE</span>` : ''}
  </div>
  ${terrainHeadline ? `<div style="font-size:15px;font-weight:bold;color:#1a3a2a;margin-bottom:4px">${terrainHeadline}</div>` : ''}
  <div style="font-size:12px;color:#333;line-height:1.55;font-style:italic">"${terrainNarrative}"</div>
  ${terrainDriver ? `
  <div style="margin-top:6px">
    <span style="background:#1a3a2a;color:white;padding:3px 10px;font-size:10px;letter-spacing:1px">PRIMARY DRIVER: ${terrainDriver}</span>
  </div>` : ''}
</div>` : ''}
  <div class="score-hero">
    <div style="font-size:13px;text-transform:uppercase;letter-spacing:2px;color:#666;margin-bottom:8px">Overall Huntability Score</div>
    <div class="big-score" style="color:${scoreColor(summary?.topStandScore ?? 0)}">${summary?.topStandScore ?? 0}</div>
    <div style="font-size:18px;letter-spacing:3px;margin-top:8px;color:${scoreColor(summary?.topStandScore ?? 0)}">${scoreLabel(summary?.topStandScore ?? 0)}</div>
    <div class="score-sub">Based on terrain analysis, corridor strength, bedding proximity, and wind alignment</div>
  </div>
  ${leaseIntelHTML}
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
  ${dualAudienceHTML}
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
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:10px">
    <div class="stat-box">
      <div class="stat-value">${summary?.analysisAreaAcres?.toFixed(0) ?? '0'}</div>
      <div class="stat-label">Analysis Area (Acres)</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${displayElevRange} ft</div>
      <div class="stat-label">Elevation Relief</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${displayElevMin} – ${displayElevMax} ft</div>
      <div class="stat-label">Elevation Band</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${displayElevAvg} ft</div>
      <div class="stat-label">Avg Elevation</div>
    </div>
  </div>
  <div class="footer">
    <span>Report ID: ${reportId}</span>
    <span>TERRA FIRMA PARTNERS</span>
    <span>Page 1 of ${mapImageBase64 ? '4' : '3'}</span>
  </div>
</div>

<div class="page border${wm}">
  <div class="header">
    <div><h1>TERRA FIRMA PARTNERS</h1><p>Terrain Intelligence for Landowners</p></div>
    <div style="text-align:right;font-size:11px;opacity:0.8">
      <div>Report ID: ${reportId}</div>
      <div>Prevailing Wind: ${prevailingWind ?? 'Not Set'}</div>
    </div>
  </div>
  <div style="text-align:center;margin-bottom:24px">
    <div style="font-size:22px;font-weight:bold;letter-spacing:2px;color:#1a3a2a">INTERCEPT POINT ANALYSIS</div>
    <div style="font-size:12px;color:#666;margin-top:6px">Top recommended intercept locations based on terrain, wind, and deer movement intelligence</div>
  </div>
  <div class="gold-bar"></div>
  ${(stands ?? []).map((stand: any, i: number) => `
  <div class="stand-card">
    <div class="stand-header" style="background:${i === 0 ? '#1a3a2a' : '#f8f6f0'};color:${i === 0 ? 'white' : '#1a1a1a'}">
      <div style="display:flex;align-items:center">
        <div style="text-align:center;margin-right:12px">
          <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-bottom:2px">INTERCEPT</div>
          <div style="font-size:24px;font-weight:bold;color:#c9a84c">#${stand.rank}</div>
        </div>
        <div>
          <div class="stand-name">${stand.name}</div>
          <div class="stand-tier">${stand.tier} · ${stand.resilience}</div>
        </div>
      </div>
      <div class="stand-score-badge" style="background:${scoreColor(stand.score)}">${stand.score}</div>
    </div>
    <div class="stand-body">
      <div class="stand-reasoning">"${stand.reasoning && stand.reasoning.trim().length > 10 ? stand.reasoning : `Intercept point at ${stand.elevation ? Math.round(stand.elevation * 3.281) + 'ft elevation' : 'optimal terrain position'} with ${stand.distToCorridorM ? Math.round(stand.distToCorridorM * 1.094) + ' yards to nearest corridor' : 'strong corridor access'}. Approach risk: ${stand.approachRisk || 'low'}.`}"</div>
      <div class="stand-stats">
        <div class="stand-stat">
          <div class="stand-stat-val" style="color:${riskColor(stand.approachRisk)}">${(stand.approachRisk ?? 'med').toUpperCase()}</div>
          <div class="stand-stat-key">Approach Risk</div>
        </div>
        <div class="stand-stat">
          <div class="stand-stat-val">${stand.distToCorridorM ? Math.round(stand.distToCorridorM * 1.0936) : '—'} yds</div>
          <div class="stand-stat-key">To Corridor</div>
        </div>
        <div class="stand-stat">
          <div class="stand-stat-val">${stand.distToBeddingM ? Math.round(stand.distToBeddingM * 1.0936) : '—'} yds</div>
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
        <div class="corridor-fill" style="width:${Math.min(100, Math.round((corridors?.parcelCoverage ?? 0) * 100))}%"></div>
      </div>
      <div style="font-size:10px;color:#666;margin-top:4px">${Math.min(100, Math.round((corridors?.parcelCoverage ?? 0) * 100))}% parcel corridor coverage</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${corridors?.hardFunnelCount ?? 0} hard · ${corridors?.slightFunnelCount ?? 0} slight</div>
      <div class="stat-label">Funnel Zones Detected</div>
      <div style="font-size:11px;color:#1a3a2a;margin-top:8px;font-weight:bold">
        ${(corridors?.hardFunnelCount ?? 0) > 0 ? '★ Hard funnels present — high value intercept locations' : 'Soft funnels only — terrain dependent movement'}
      </div>
    </div>
  </div>
  <div style="background:#f8f6f0;border-left:4px solid #c9a84c;padding:14px 16px;margin-top:12px;margin-bottom:12px">
    <div style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#1a3a2a;margin-bottom:6px">
      Understanding Funnel Zones
    </div>
    <div style="font-size:11px;color:#333;line-height:1.7">
      <strong>Hard Funnels</strong> are tight terrain pinch points — saddles, creek crossings, ridge gaps — that physically 
      force deer through a narrow zone. Positions near hard funnels intercept nearly all deer movement in that area.<br><br>
      <strong>Slight Funnels</strong> are softer compressions — benches, field edges, gentle draws — where deer prefer 
      to travel but aren't forced. These are excellent intercept locations but require more precise wind management.<br><br>
      <strong>Pro Tip:</strong> ${(corridors?.hardFunnelCount ?? 0) > 0 
        ? `This property has ${corridors.hardFunnelCount} hard funnel${corridors.hardFunnelCount > 1 ? 's' : ''} — prioritize intercept placement within 50 yards of these natural pinch points for maximum encounter rates.`
        : 'Focus intercept points on slight funnels with favorable wind — approach from downwind for best results.'}
    </div>
  </div>
  <div class="disclaimer">
    This report is generated from satellite terrain analysis and predictive modeling. Intercept point recommendations are based on terrain geometry,
    historical deer movement patterns, and wind modeling. Always scout properties in person before committing to intercept positions.
    Terra Firma Partners is not responsible for hunting outcomes. Data sources: Regrid, USGS DEM, USDA. Report ID: ${reportId}
  </div>
  <div class="footer">
    <span>Report ID: ${reportId}</span>
    <span>TERRA FIRMA PARTNERS</span>
    <span>Page 2 of ${mapImageBase64 ? '4' : '3'}</span>
  </div>
</div>

${mapImageBase64 ? `
<div class="page border${wm}">
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
      <span style="color:white;font-size:10px">🎯 #1 Intercept — ${stands?.[0]?.name ?? 'Top Intercept'}</span>
      ${stands?.[1] ? `<span style="color:white;font-size:10px">🎯 #2 Intercept — ${stands[1].name}</span>` : ''}
      ${stands?.[2] ? `<span style="color:white;font-size:10px">🎯 #3 Intercept — ${stands[2].name}</span>` : ''}
    </div>
  </div>

  <div class="section-title">Intercept Location Summary</div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
    ${(stands ?? []).slice(0,3).map((s: any, i: number) => `
    <div style="border:2px solid #1a3a2a;padding:12px;background:#f8f6f0">
      <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-bottom:2px">INTERCEPT</div>
      <div style="font-size:11px;font-weight:bold;color:#c9a84c;margin-bottom:4px">#${s.rank} — ${s.name}</div>
      <div style="font-size:10px;color:#666;margin-bottom:6px">${s.tier}</div>
      <div style="font-size:18px;font-weight:bold;color:#1a3a2a;margin-bottom:6px">${s.score}</div>
      <div style="font-size:10px;color:#333">${s.coords ? `${s.coords[1].toFixed(5)}°N ${Math.abs(s.coords[0]).toFixed(5)}°W` : 'Coords unavailable'}</div>
      <div style="font-size:10px;color:#666;margin-top:4px">Elevation: ${s.elevation ? Math.round(s.elevation * 3.281) : '—'}ft</div>
    </div>`).join('')}
  </div>

  ${terrainNarrative ? `
<div style="background:#f8f6f0;border-left:4px solid #c9a84c;padding:14px 16px;margin-bottom:16px">
  <div style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#1a3a2a;margin-bottom:6px">
    Terrain Intelligence — ${terrainHeadline ?? 'Analysis Summary'}
  </div>
  <div style="font-size:11px;color:#333;line-height:1.7;font-style:italic">"${terrainNarrative}"</div>
  ${terrainDriver ? `<div style="margin-top:8px"><span style="background:#1a3a2a;color:white;padding:2px 8px;font-size:9px;letter-spacing:1px">PRIMARY DRIVER: ${terrainDriver}</span></div>` : ''}
</div>` : ''}
  <div class="section-title">Approach & Wind Strategy</div>
  <div style="background:#f8f6f0;border:1px solid #ddd;padding:16px;margin-bottom:16px">
    <div style="font-size:12px;color:#333;line-height:1.8">
      <div style="margin-bottom:8px"><strong>Prevailing Wind:</strong> ${prevailingWind ?? 'Not set'} — plan entry routes to keep wind in your favor approaching each intercept point.</div>
      <div style="margin-bottom:8px"><strong>Top Intercept (${stands?.[0]?.name ?? '—'}):</strong> Best hunted on ${(stands?.[0]?.windOk ?? []).join(', ') || 'any'} winds. Approach risk: ${stands?.[0]?.approachRisk ?? '—'}.</div>
      ${stands?.[1] ? `<div style="margin-bottom:8px"><strong>Intercept 2 (${stands[1].name}):</strong> Best hunted on ${(stands[1].windOk ?? []).join(', ') || 'any'} winds. Approach risk: ${stands[1].approachRisk ?? '—'}.</div>` : ''}
      ${stands?.[2] ? `<div><strong>Intercept 3 (${stands[2].name}):</strong> Best hunted on ${(stands[2].windOk ?? []).join(', ') || 'any'} winds. Approach risk: ${stands[2].approachRisk ?? '—'}.</div>` : ''}
    </div>
  </div>

  <div style="background:#1a3a2a;color:white;padding:12px 16px;font-size:11px;line-height:1.6">
    <strong>PRO TIP:</strong> Always approach intercept points from downwind. Check wind forecast the night before and select the intercept whose good wind directions match tomorrow's forecast. 
    Deer will smell you from 300+ yards — your entry route matters as much as your intercept position.
  </div>

  <div class="footer">
    <span>Report ID: ${reportId}</span>
    <span>TERRA FIRMA PARTNERS</span>
    <span>Page 3 of 4</span>
  </div>
</div>
` : ''}

${certificatePage}

</body>
</html>`;

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