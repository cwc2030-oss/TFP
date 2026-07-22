/**
 * lib/report/build-html.ts
 *
 * Pure-function module that assembles the Hunting Intelligence Report HTML.
 * Extracted from app/api/parcel-hunt-file/route.ts (Chunk 6 refactor).
 *
 * Zero side-effects — no auth, no network calls, no Playwright.
 * The route owns auth, Mapbox map fetch, and HTML2PDF conversion.
 */

import { estimateLeasePerAcre } from '@/lib/lease-estimate';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Escape HTML-special chars for safe attribute embedding */
const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');

/** Title-case an address string, preserving separators (spaces, hyphens, commas) */
const titleCaseAddress = (s: string) =>
  s.replace(/[a-zA-Z]+/g, w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  );

const seasonLabel = (s: string) =>
  s === 'early' ? 'Early Season' : s === 'rut' ? 'Rut Season' : 'Late Season';

const scoreColor = (s: number) =>
  s >= 70 ? '#2d6a4f' : s >= 40 ? '#d4a017' : '#c0392b';

const scoreLabel = (s: number) =>
  s >= 70 ? 'PRIME' : s >= 40 ? 'HUNTABLE' : 'MARGINAL';

const riskColor = (r: string) =>
  r === 'low' ? '#2d6a4f' : r === 'medium' ? '#d4a017' : '#c0392b';

const seasonGrade = (s: number) => {
  if (s <= 0 || !isFinite(s)) return '—';
  return s >= 90 ? 'A+' : s >= 80 ? 'A' : s >= 70 ? 'B+' : s >= 60 ? 'B' : s >= 50 ? 'C+' : s >= 40 ? 'C' : 'D';
};

const seasonGradeColor = (s: number) => s >= 70 ? '#2d6a4f' : s >= 50 ? '#d4a017' : '#c0392b';

// ── CSS ──────────────────────────────────────────────────────────────────────

const css = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, serif; color: #1a1a1a; background: white; }
  .page { width: 816px; padding: 48px; padding-bottom: 60px; position: relative; }
  /* Only the certificate gets its own page — everything else flows continuously */
  .page-cert { page-break-before: always; page-break-inside: avoid; break-inside: avoid; }
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
  .stat-box { background: #f8f6f0; border: 1px solid #ddd; padding: 16px; text-align: center; page-break-inside: avoid; break-inside: avoid; }
  .stat-value { font-size: 28px; font-weight: bold; color: #1a3a2a; }
  .stat-label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .stand-card { border: 2px solid #1a3a2a; margin-bottom: 16px; page-break-inside: avoid; break-inside: avoid; }
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
  .footer { display: flex; justify-content: space-between; font-size: 10px; color: #999; border-top: 1px solid #ddd; padding-top: 8px; margin-top: 24px; }
  .disclaimer { font-size: 9px; color: #999; line-height: 1.5; margin-top: 16px; padding-top: 12px; border-top: 1px solid #eee; }
  /* Keep atomic blocks together — avoids splitting a single card across pages */
  .score-hero, .season-grid, .grid-2, .grid-3 { page-break-inside: avoid; break-inside: avoid; }
  .section-title { page-break-after: avoid; break-after: avoid; }
  .info-block { page-break-inside: avoid; break-inside: avoid; }
  .map-container { page-break-inside: avoid; break-inside: avoid; }
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

// ── Payload interface ────────────────────────────────────────────────────────

export interface HuntingReportPayload {
  /* From the client request body */
  address: string;
  lat: number;
  lng: number;
  acreage: number;
  county: string;
  state: string;
  prevailingWind: string;
  stands: any[];
  summary: any;
  corridors: any;
  seasonScores: any;
  parcelCoords: any;
  terrainHeadline?: string;
  terrainNarrative?: string;
  terrainDriver?: string;
  terrainConfidence?: string;
  elevRange?: number;
  isTerritory?: boolean;
  territoryName?: string;
  territoryParcelCount?: number;
  territoryParcels?: any[] | null;
  savedPropertyId?: string | null;
  /** PHASE 2: real backbone verdict (gate-real / pull-fake). Mirrors the map
   *  render gate: derived from intelMetrics on the client. */
  backbone?: {
    state: 'confirmed' | 'marginal' | 'flat' | null;
    ridgeSpineCount: number;
    saddleCrossings: number;
    convergenceCount: number;
  } | null;
  /* Computed by the route before calling */
  reportId: string;
  generated: string;
  isFreeTier: boolean;
  mapImageBase64?: string;
  /** Origin URL for building the "List This Property" CTA link */
  origin?: string;
}

// ── Main builder ─────────────────────────────────────────────────────────────

export function buildHuntingReportHtml(payload: HuntingReportPayload): string {
  const {
    address, lat, lng, acreage, county, state,
    prevailingWind, stands, summary, corridors, seasonScores,
    terrainHeadline, terrainNarrative, terrainDriver, terrainConfidence, elevRange,
    isTerritory = false,
    territoryName = 'My Territory',
    territoryParcelCount = 1,
    territoryParcels: territoryParcelList = null,
    savedPropertyId = null,
    backbone = null,
    reportId, generated, isFreeTier,
    mapImageBase64 = '',
    origin = 'https://terrafirma.partners',
  } = payload;

  // ── Defensive acreage coercion (Bug 1/4/5: URL param may arrive as string) ──
  const safeAcreage = typeof acreage === 'number' && Number.isFinite(acreage)
    ? acreage
    : (parseFloat(String(acreage).replace(/[^0-9.]/g, '')) || 40);

  // ── Elevation derived values ──
  const standElevations = (stands ?? [])
    .map((s: any) => s.elevation ? Math.round(s.elevation * 3.281) : 0)
    .filter((e: number) => e > 0);
  const computedElevRange = standElevations.length >= 2
    ? Math.round(Math.max(...standElevations) - Math.min(...standElevations))
    : 0;
  const displayElevRange = (elevRange ?? 0) > 0 ? elevRange! : computedElevRange;
  const displayElevMin = standElevations.length ? Math.round(Math.min(...standElevations)) : 0;
  const displayElevMax = standElevations.length ? Math.round(Math.max(...standElevations)) : 0;
  const displayElevAvg = standElevations.length
    ? Math.round(standElevations.reduce((a: number, b: number) => a + b, 0) / standElevations.length)
    : 0;
  const hasElevationData = displayElevRange > 0 || displayElevMin > 0 || displayElevMax > 0;

  // ── Corridor totals ──
  const corridorPrimary  = Number(corridors?.primaryCount      ?? 0) || 0;
  const corridorPossible = Number(corridors?.possibleCount     ?? 0) || 0;
  const funnelHard       = Number(corridors?.hardFunnelCount   ?? 0) || 0;
  const funnelSlight     = Number(corridors?.slightFunnelCount ?? 0) || 0;
  const funnelTotal      = Number(summary?.funnelCount ?? 0) || 0;
  const corridorTotal    = corridorPrimary + corridorPossible;
  const movementFeatureTotal = corridorTotal + funnelHard + funnelSlight;

  // ── Season grades ──
  const baseScore = Number(seasonScores?.topScore ?? summary?.topStandScore ?? 0) || 0;
  const recommended = seasonScores?.recommended ?? 'rut';
  const earlyRaw = Number(seasonScores?.earlyScore ?? Math.round(baseScore * 0.82)) || Math.round(baseScore * 0.82);
  const rutRaw   = Number(seasonScores?.rutScore   ?? baseScore) || baseScore;
  const lateRaw  = Number(seasonScores?.lateScore  ?? Math.round(baseScore * 0.75)) || Math.round(baseScore * 0.75);
  const seasonScoresComputed: Record<string, { score: number; grade: string; color: string }> = {
    early: { score: earlyRaw, grade: seasonGrade(earlyRaw), color: seasonGradeColor(earlyRaw) },
    rut:   { score: rutRaw,   grade: seasonGrade(rutRaw),   color: seasonGradeColor(rutRaw) },
    late:  { score: lateRaw,  grade: seasonGrade(lateRaw),  color: seasonGradeColor(lateRaw) },
  };

  const wm = isFreeTier ? ' preview-watermark' : '';

  // ── PHASE 1 KILL-SWITCH (Jul 17 2026) ──────────────────────────────────────
  // Marketplace is now public. The v1 huntability score / letter grade /
  // "CERTIFIED HUNTABLE" badge / bedding + funnel + stand-count stat boxes are
  // non-discriminating fabrications (flat parcels printed the same numbers as
  // confirmed ones). Hide them on the live report + share link NOW to stop the
  // fabrication; the Phase 2 gate-real rebuild wires in the real backbone verdict.
  const HIDE_FAB_SCORES = true;

  // ── Lease Intelligence ──
  const leaseValuePerAcre = estimateLeasePerAcre({ topStandScore: summary?.topStandScore });

  // ── PHASE 2: real backbone verdict (gate-real / pull-fake) ──────────────────
  // Derived on the client from intelMetrics (same source as the map render gate).
  const bbState: 'confirmed' | 'marginal' | 'flat' | null = backbone?.state ?? null;
  const bbRidges = Number(backbone?.ridgeSpineCount ?? 0) || 0;
  const bbSaddles = Number(backbone?.saddleCrossings ?? 0) || 0;
  const bbConvergence = Number(backbone?.convergenceCount ?? 0) || 0;
  const bbStateLabel = bbState === 'confirmed' ? 'Confirmed Ridge Backbone'
    : bbState === 'marginal' ? 'Marginal Relief'
    : bbState === 'flat' ? 'Flat \u2014 No Confirmed Backbone'
    : 'Terrain Analyzed';
  const bbStateColor = bbState === 'confirmed' ? '#1a3a2a'
    : bbState === 'marginal' ? '#8b6f47'
    : '#777';

  // "CERTIFIED HUNTABLE" was a non-discriminating quality claim (flat parcels got
  // the same badge as confirmed ones). It is retired. This badge is an
  // analysis-run marker: it states the terrain WAS analyzed, NOT that it is
  // guaranteed huntable.
  const certifiedBadge = `<div style="background:#33413a;color:#c9a84c;padding:8px 20px;font-size:11px;letter-spacing:3px;font-weight:bold;display:inline-block">&#10003; TERRAIN ANALYZED</div>`;

  const carryingCapacity = Math.max(1, Math.round(safeAcreage / 40));
  const standInventory = (stands ?? []).length;

  const leaseIntelHTML = `
<div style="border:2px solid #c9a84c;padding:12px 14px;margin-bottom:14px;background:#fdf9f0">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <div style="font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#1a3a2a">Lease Intelligence</div>
    ${certifiedBadge}
  </div>
  <div style="display:grid;grid-template-columns:repeat(${HIDE_FAB_SCORES ? 3 : 4},1fr);gap:10px;margin-bottom:8px">
    <div style="text-align:center;background:white;border:1px solid #ddd;padding:10px">
      <div style="font-size:20px;font-weight:bold;color:#1a3a2a">${leaseValuePerAcre}</div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-top:2px">Est. Lease / Acre / Yr</div>
    </div>
    ${HIDE_FAB_SCORES ? '' : `<div style="text-align:center;background:white;border:1px solid #ddd;padding:10px">
      <div style="font-size:20px;font-weight:bold;color:#1a3a2a">${standInventory}</div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-top:2px">Prime Intercept Points</div>
    </div>`}
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

  // ── PHASE 2: real terrain-backbone counts (differ per parcel; flat = zeros) ──
  const backboneBlockHTML = `
<div style="border:2px solid #1a3a2a;padding:12px 14px;margin-bottom:14px;background:#fff">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <div style="font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#1a3a2a">Terrain Backbone</div>
    <span style="background:${bbStateColor};color:#fff;padding:3px 10px;font-size:10px;letter-spacing:1px">${bbStateLabel.toUpperCase()}</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
    <div style="text-align:center;background:#f8f6f0;border:1px solid #ddd;padding:10px">
      <div style="font-size:22px;font-weight:bold;color:#1a3a2a">${bbRidges}</div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-top:2px">Ridge Spines</div>
    </div>
    <div style="text-align:center;background:#f8f6f0;border:1px solid #ddd;padding:10px">
      <div style="font-size:22px;font-weight:bold;color:#1a3a2a">${bbSaddles}</div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-top:2px">Saddle Crossings</div>
    </div>
    <div style="text-align:center;background:#f8f6f0;border:1px solid #ddd;padding:10px">
      <div style="font-size:22px;font-weight:bold;color:#1a3a2a">${bbConvergence}</div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-top:2px">Convergence Zones</div>
    </div>
  </div>
  ${bbState === 'flat' ? `<div style="margin-top:8px;background:#f0ede4;padding:7px 12px;border-left:3px solid #999;font-size:11px;color:#555;line-height:1.45">No confirmed ridge backbone detected on this parcel. Terrain is flat or low-relief; deer movement is not concentrated by topographic funnels here.</div>` : ''}
  <div style="margin-top:6px;font-size:10px;color:#aaa;font-style:italic;line-height:1.3">Counts reflect terrain features detected by the analysis run. "Terrain Analyzed" indicates the parcel was processed, not a guarantee of hunting quality.</div>
</div>`;

  const dualAudienceHTML = `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:2px solid #1a3a2a;margin-bottom:14px">
  <div style="padding:12px 14px;border-right:1px solid #1a3a2a">
    <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-bottom:4px">For the Landowner</div>
    <div style="font-size:13px;font-weight:bold;color:#1a3a2a;margin-bottom:4px">Lease With Confidence</div>
    <div style="font-size:11px;color:#444;line-height:1.5">This terrain assessment documents the topographic character of your property using satellite intelligence. Share this report with prospective lessees to show the terrain features present and attract serious hunters who understand land quality.</div>
  </div>
  <div style="padding:12px 14px;background:#f8f6f0">
    <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-bottom:4px">For the Hunter</div>
    <div style="font-size:13px;font-weight:bold;color:#1a3a2a;margin-bottom:4px">Hunt With Intelligence</div>
    <div style="font-size:11px;color:#444;line-height:1.5">Your terrain analysis traces exactly where deer move, funnel, and converge on this property. Use the measured corridors, funnels, and saddle crossings in this report to put yourself in the right position before opening day.</div>
  </div>
</div>`;

  // ── Certificate variables ──
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
  const listCtaHref = typeof savedPropertyId === 'string' && savedPropertyId.trim()
    ? `${origin}/dashboard/listings/new?savedPropertyId=${encodeURIComponent(savedPropertyId.trim())}&cta=pdf`
    : null;

  const listPropertyCtaHTML = listCtaHref ? `
<div style="margin-top:24px;border:2px solid #c9a84c;background:#fffaf0;padding:18px 20px;text-align:center">
  <div style="font-size:20px;font-weight:bold;color:#1a3a2a;margin-bottom:8px">You&apos;ve mapped it. Ready to lease it?</div>
  <div style="font-size:12px;color:#444;line-height:1.6;margin-bottom:14px">List this property and connect with vetted hunters in your area.</div>
  <a href="${listCtaHref}" style="display:inline-block;background:#1a3a2a;color:white;text-decoration:none;padding:11px 18px;border-radius:3px;font-size:12px;font-weight:bold;letter-spacing:1px">→ List This Property</a>
</div>` : '';

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
    <span style="color:#c9a84c">${Math.round(safeAcreage)} acres across ${territoryParcelCount} parcels</span>
  </div>
</div>` : '';

  // ── County / state parsing ──
  const addressParts = (address ?? '').split(',').map((s: string) => s.trim());
  const rawCounty = addressParts
    .find((p: string) =>
      /\bcounty\b/i.test(p) &&
      !/county\s+(road|rd|highway|hwy|route|rt|line|ln|street|st|drive|dr|lane)/i.test(p)
    )?.replace(/county/i, '').trim() ?? county ?? '';
  // Title-case the county name (fixes lowercase "plattin" → "Plattin", "ste. genevieve" → "Ste. Genevieve")
  const parsedCounty = rawCounty
    ? rawCounty.replace(/\b\w/g, (c: string) => c.toUpperCase())
    : '';
  const stateZipMatch = (address ?? '').match(/\b([A-Z]{2})\s+\d{5}\b/);
  // Force uppercase state code (fixes "Mo" → "MO")
  const parsedState = (stateZipMatch?.[1] ?? state ?? 'MO').toUpperCase();

  // ── Page count ──
  // Footer is now rendered by Playwright's native display_header_footer
  // using CSS pageNumber / totalPages classes, so we no longer hardcode.

  // ── Assemble HTML ─────────────────────────────────────────────────────────
  // ── Open Graph + Twitter Card meta ──
  const titleSubject = isTerritory
    ? `${territoryName} — ${territoryParcelCount} Parcels`
    : address;
  const ogTitle = HIDE_FAB_SCORES ? `${titleSubject} · Terrain Analyzed` : `${titleSubject} · Huntability Score: ${summary?.topStandScore ?? 'N/A'}`;
  const standCount = stands?.length ?? 0;
  const ogDescription = HIDE_FAB_SCORES ? `${safeAcreage} acres · Terrain analysis · Powered by Terrain Brain™` : `${safeAcreage} acres · ${standCount} stand locations · Verified Terrain · Powered by Terrain Brain™`;
  const ogUrl = `${origin}/report/${reportId}`;
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
  const mapboxBase = 'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static';
  const ogImage = `${mapboxBase}/pin-s+ffd700(${lng},${lat})/${lng},${lat},13,0/1200x630@2x?access_token=${mapboxToken}`;

  const ogMeta = `
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Terra Firma Partners" />
<meta property="og:title" content="${escHtml(ogTitle)}" />
<meta property="og:description" content="${escHtml(ogDescription)}" />
<meta property="og:url" content="${ogUrl}" />
<meta property="og:image" content="${ogImage}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="Satellite view of ${escHtml(titleSubject)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escHtml(ogTitle)}" />
<meta name="twitter:description" content="${escHtml(ogDescription)}" />
<meta name="twitter:image" content="${ogImage}" />`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
${ogMeta}
<style>${css}</style>
</head>
<body>

<div class="page page-1 border${wm}">
  <div class="header">
    <div><h1>TERRA FIRMA PARTNERS</h1><p>Terrain Intelligence for Landowners · Powered by Terrain Brain™</p></div>
    <div style="text-align:right;font-size:11px;opacity:0.8">
      <div>Report ID: ${reportId}</div><div>Generated: ${generated}</div>
    </div>
  </div>
  <div style="text-align:center;margin-bottom:14px">
    <div style="font-size:26px;font-weight:bold;letter-spacing:2px;color:#1a3a2a">${isTerritory ? 'TERRITORY INTELLIGENCE REPORT' : 'HUNTING INTELLIGENCE REPORT'}</div>
    <div style="font-size:13px;color:#666;margin-top:4px">${isTerritory ? `${territoryName} — ${territoryParcelCount} parcels — ${Math.round(safeAcreage)} total acres` : titleCaseAddress(address)}</div>
    <div style="font-size:12px;color:#999;margin-top:2px">${safeAcreage.toFixed(1)} Acres${parsedCounty ? ` | ${parsedCounty} County, ${parsedState}` : ` | ${parsedState}`}</div>
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
  ${bbState ? backboneBlockHTML : ''}
  ${leaseIntelHTML}
  ${HIDE_FAB_SCORES ? `
  <div class="grid-3" style="grid-template-columns:1fr">
    <div class="stat-box">
      <div class="stat-value">${corridorPrimary}</div>
      <div class="stat-label">Primary Corridors</div>
    </div>
  </div>` : `
  <div class="grid-3">
    <div class="stat-box">
      <div class="stat-value">${summary?.totalBeddingAcres?.toFixed(1) ?? '0'}</div>
      <div class="stat-label">Bedding Acres</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${corridorPrimary}</div>
      <div class="stat-label">Primary Corridors</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${summary?.funnelCount ?? 0}</div>
      <div class="stat-label">Funnel Zones</div>
    </div>
  </div>`}
  ${dualAudienceHTML}
  ${HIDE_FAB_SCORES ? '' : `
  <div class="section-title">Seasonal Huntability</div>
  <div class="season-grid">
    ${['early','rut','late'].map((s: string) => {
      const sc = seasonScoresComputed[s];
      const isRec = s === recommended;
      return `
    <div class="season-cell ${isRec ? 'season-recommended' : ''}">
      <div class="season-name">${seasonLabel(s)}</div>
      <div style="font-size:40px;font-weight:bold;line-height:1;margin:10px 0 4px;color:${isRec ? '#c9a84c' : sc.color}">${sc.grade}</div>
      <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:${isRec ? 'rgba(255,255,255,0.6)' : '#999'};margin-bottom:6px">Huntability Grade</div>
      <div style="font-size:12px;color:${isRec ? 'rgba(255,255,255,0.75)' : '#666'};margin-bottom:8px">${sc.score} / 100</div>
      ${isRec ? `<div style="display:inline-block;padding:4px 12px;font-size:11px;background:#c9a84c;color:#1a3a2a">★ RECOMMENDED</div>` : ''}
    </div>`;
    }).join('')}
  </div>`}
  ${hasElevationData ? `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:10px">
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
  </div>` : `<div style="display:grid;grid-template-columns:1fr;gap:12px;margin-bottom:10px">
    <div class="stat-box">
      <div class="stat-value">${summary?.analysisAreaAcres?.toFixed(0) ?? '0'} acres</div>
      <div class="stat-label">Analysis Area</div>
    </div>
  </div>`}
</div>

<div class="page border${wm}">
  <div class="header">
    <div><h1>TERRA FIRMA PARTNERS</h1><p>Terrain Intelligence for Landowners · Powered by Terrain Brain™</p></div>
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
  ${(stands ?? []).length === 0 ? `
  <div style="text-align:center;padding:40px 24px;border:2px dashed #c9a84c;background:#fdf9f0;margin-bottom:24px">
    <div style="font-size:16px;font-weight:bold;color:#1a3a2a;margin-bottom:8px">Stand Analysis In Progress</div>
    <div style="font-size:12px;color:#666;line-height:1.6">Intercept point data was not available when this report was generated.<br/>Re-download after the terrain analysis completes to include stand locations.</div>
  </div>
  ` : (stands ?? []).map((stand: any, i: number) => `
  <div class="stand-card">
    <div class="stand-header" style="background:${i === 0 ? '#1a3a2a' : '#f8f6f0'};color:${i === 0 ? 'white' : '#1a1a1a'}">
      <div style="display:flex;align-items:center">
        <div style="text-align:center;margin-right:12px">
          <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-bottom:2px">INTERCEPT</div>
          <div style="font-size:24px;font-weight:bold;color:#c9a84c">#${stand.rank}</div>
        </div>
        <div>
          <div class="stand-name">Intercept #${stand.rank}</div>
          <div class="stand-tier">${stand.tier} · ${stand.resilience}</div>
        </div>
      </div>
      ${HIDE_FAB_SCORES ? '' : `<div class="stand-score-badge" style="background:${scoreColor(stand.score)}">${stand.score}</div>`}
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
      <div class="stat-value">${corridorPrimary} primary · ${corridorPossible} possible</div>
      <div class="stat-label">Movement Corridors Detected</div>
      <div class="corridor-bar">
        <div class="corridor-fill" style="width:${Math.min(100, Math.round((corridors?.parcelCoverage ?? 0) * 100))}%"></div>
      </div>
      <div style="font-size:10px;color:#666;margin-top:4px">${Math.min(100, Math.round((corridors?.parcelCoverage ?? 0) * 100))}% parcel corridor coverage</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${(funnelHard + funnelSlight) > 0
        ? `${funnelHard} hard · ${funnelSlight} slight`
        : funnelTotal > 0
          ? `${funnelTotal} funnel${funnelTotal === 1 ? '' : 's'} detected · classification pending`
          : 'No funnel zones detected'}</div>
      <div class="stat-label">Funnel Zones Detected</div>
      <div style="font-size:11px;color:#1a3a2a;margin-top:8px;font-weight:bold">
        ${funnelHard > 0
          ? '★ Hard funnels present — high value intercept locations'
          : funnelTotal > 0
            ? '⟳ Funnel classification in progress — check back after full analysis'
            : 'No funnel pinch points identified on this parcel'}
      </div>
    </div>
  </div>
  <div class="info-block" style="background:#f8f6f0;border-left:4px solid #c9a84c;padding:14px 16px;margin-top:12px;margin-bottom:12px">
    <div style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#1a3a2a;margin-bottom:6px">
      Understanding Funnel Zones
    </div>
    <div style="font-size:11px;color:#333;line-height:1.7">
      <strong>Hard Funnels</strong> are tight terrain pinch points — saddles, creek crossings, ridge gaps — that physically 
      force deer through a narrow zone. Positions near hard funnels intercept nearly all deer movement in that area.<br><br>
      <strong>Slight Funnels</strong> are softer compressions — benches, field edges, gentle draws — where deer prefer 
      to travel but aren't forced. These are excellent setup locations but require more precise wind management.<br><br>
      <strong>Pro Tip:</strong> ${funnelHard > 0
        ? `This property has ${funnelHard} hard funnel${funnelHard > 1 ? 's' : ''} — set up within 50 yards of these natural pinch points for maximum encounter rates.`
        : funnelTotal > 0
          ? `This property has ${funnelTotal} funnel zone${funnelTotal === 1 ? '' : 's'} identified by terrain analysis. Once classification completes, revisit for hard vs. slight breakdown.`
          : 'Focus on corridor edges and approach from downwind for best results.'}
    </div>
  </div>
  <div class="disclaimer">
    This report is generated from satellite terrain analysis and elevation modeling. The measured terrain drivers and traced corridors are derived from terrain geometry and elevation structure.
    Always scout properties in person before committing to positions.
    Terra Firma Partners is not responsible for hunting outcomes. Data sources: Regrid, USGS DEM, USDA. Report ID: ${reportId}
  </div>
</div>

${mapImageBase64 ? `
<div class="page border${wm}">
  <div class="header">
    <div><h1>TERRA FIRMA PARTNERS</h1><p>Terrain Intelligence for Landowners · Powered by Terrain Brain™</p></div>
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

  <div class="map-container" style="border:3px solid #1a3a2a;margin-bottom:20px;position:relative">
    <img src="${mapImageBase64}" style="width:100%;display:block" alt="Terrain Hunt Map"/>
    <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(26,58,42,0.85);padding:8px 12px;display:flex;gap:24px;align-items:center">
      <span style="color:white;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:bold">Legend:</span>
      <span style="color:white;font-size:10px">🎯 Intercept #1</span>
      ${stands?.[1] ? `<span style="color:white;font-size:10px">🎯 Intercept #2</span>` : ''}
      ${stands?.[2] ? `<span style="color:white;font-size:10px">🎯 Intercept #3</span>` : ''}
    </div>
  </div>

  <div class="section-title">Intercept Location Summary</div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
    ${(stands ?? []).slice(0,3).map((s: any, i: number) => `
    <div style="border:2px solid #1a3a2a;padding:12px;background:#f8f6f0">
      <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-bottom:2px">INTERCEPT</div>
      <div style="font-size:11px;font-weight:bold;color:#c9a84c;margin-bottom:4px">Intercept #${s.rank}</div>
      <div style="font-size:10px;color:#666;margin-bottom:6px">${s.tier}</div>
      ${HIDE_FAB_SCORES ? '' : `<div style="font-size:18px;font-weight:bold;color:#1a3a2a;margin-bottom:6px">${s.score}</div>`}
      <div style="font-size:10px;color:#333">${s.coords ? `${s.coords[1].toFixed(5)}°N ${Math.abs(s.coords[0]).toFixed(5)}°W` : 'Coords unavailable'}</div>
      <div style="font-size:10px;color:#666;margin-top:4px">Elevation: ${s.elevation ? Math.round(s.elevation * 3.281) : '—'}ft</div>
    </div>`).join('')}
  </div>

  ${terrainNarrative ? `
<div class="info-block" style="background:#f8f6f0;border-left:4px solid #c9a84c;padding:14px 16px;margin-bottom:16px">
  <div style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#1a3a2a;margin-bottom:6px">
    Terrain Intelligence — ${terrainHeadline ?? 'Analysis Summary'}
  </div>
  <div style="font-size:11px;color:#333;line-height:1.7;font-style:italic">"${terrainNarrative}"</div>
  ${terrainDriver ? `<div style="margin-top:8px"><span style="background:#1a3a2a;color:white;padding:2px 8px;font-size:9px;letter-spacing:1px">PRIMARY DRIVER: ${terrainDriver}</span></div>` : ''}
</div>` : ''}
  <div class="section-title">Approach & Wind Strategy</div>
  <div class="info-block" style="background:#f8f6f0;border:1px solid #ddd;padding:16px;margin-bottom:16px">
    <div style="font-size:12px;color:#333;line-height:1.8">
      <div style="margin-bottom:8px"><strong>Prevailing Wind:</strong> ${prevailingWind ?? 'Not set'} — plan entry routes to keep wind in your favor approaching each intercept point.</div>
      <div style="margin-bottom:8px"><strong>Intercept #1:</strong> Best hunted on ${(stands?.[0]?.windOk ?? []).join(', ') || 'any'} winds. Approach risk: ${stands?.[0]?.approachRisk ?? '—'}.</div>
      ${stands?.[1] ? `<div style="margin-bottom:8px"><strong>Intercept #2:</strong> Best hunted on ${(stands[1].windOk ?? []).join(', ') || 'any'} winds. Approach risk: ${stands[1].approachRisk ?? '—'}.</div>` : ''}
      ${stands?.[2] ? `<div><strong>Intercept #3:</strong> Best hunted on ${(stands[2].windOk ?? []).join(', ') || 'any'} winds. Approach risk: ${stands[2].approachRisk ?? '—'}.</div>` : ''}
    </div>
  </div>

  <div class="info-block" style="background:#1a3a2a;color:white;padding:12px 16px;font-size:11px;line-height:1.6">
    <strong>PRO TIP:</strong> Always approach intercept points from downwind. Check wind forecast the night before and select the intercept whose good wind directions match tomorrow's forecast. 
    Deer will smell you from 300+ yards — your entry route matters as much as your intercept position.
  </div>

</div>
` : ''}

<div class="page page-cert border${wm}">
  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px 48px">
    <div style="font-size:11px;letter-spacing:4px;color:#888;text-transform:uppercase;margin-bottom:16px">Terra Firma Partners — Official Terrain Assessment</div>
    <div style="border:3px solid #c9a84c;padding:32px 48px;width:100%;max-width:600px">
      <div style="font-size:13px;letter-spacing:3px;color:#666;margin-bottom:8px">${certificateTitle}</div>
      <div style="height:2px;background:linear-gradient(90deg,#c9a84c,#f0d080,#c9a84c);margin-bottom:20px"></div>
      ${HIDE_FAB_SCORES ? '' : `<div style="font-size:96px;font-weight:bold;color:${gradeColor};line-height:1;margin-bottom:8px">${huntGrade}</div>
      <div style="font-size:13px;letter-spacing:2px;color:#666;margin-bottom:20px">HUNTABILITY GRADE</div>`}
      <div style="background:#f8f6f0;padding:16px;margin-bottom:16px;text-align:left">
        <div style="font-size:12px;font-weight:bold;color:#1a3a2a;margin-bottom:8px;letter-spacing:1px">PROPERTY</div>
        <div style="font-size:14px;color:#333;margin-bottom:4px">${address}</div>
        <div style="font-size:12px;color:#666">${Math.round(safeAcreage)} Acres${parsedCounty ? ` | ${parsedCounty} County, ${parsedState}` : ` | ${parsedState}`}</div>
      </div>
      ${territorySection}
      <div style="display:grid;grid-template-columns:${HIDE_FAB_SCORES ? '1fr' : '1fr 1fr 1fr'};gap:12px;margin-bottom:16px">
        ${HIDE_FAB_SCORES ? '' : `<div style="background:#1a3a2a;color:white;padding:12px">
          <div style="font-size:20px;font-weight:bold;color:#c9a84c">${summary?.topStandScore ?? 0}</div>
          <div style="font-size:9px;letter-spacing:1px;opacity:0.8;margin-top:4px">HUNTABILITY SCORE</div>
        </div>
        <div style="background:#1a3a2a;color:white;padding:12px">
          <div style="font-size:20px;font-weight:bold;color:#c9a84c">${(stands ?? []).length}</div>
          <div style="font-size:9px;letter-spacing:1px;opacity:0.8;margin-top:4px">INTERCEPT POINTS</div>
        </div>`}
        <div style="background:#1a3a2a;color:white;padding:12px">
          <div style="font-size:20px;font-weight:bold;color:#c9a84c">${movementFeatureTotal}</div>
          <div style="font-size:9px;letter-spacing:1px;opacity:0.8;margin-top:4px">CORRIDORS${funnelHard + funnelSlight > 0 ? ' + FUNNELS' : ''}</div>
        </div>
      </div>
      <div style="height:1px;background:#ddd;margin-bottom:12px"></div>
      <div style="font-size:10px;color:#999;line-height:1.6;margin-bottom:12px">
        This certificate confirms that the above property has been analyzed using satellite elevation modeling 
        to trace its ridge, saddle, and convergence structure and the deer movement corridors that follow it. 
        Assessment valid at time of generation. Adjacent parcel analysis available separately.
      </div>
      ${listPropertyCtaHTML}
      <div style="padding-top:12px;border-top:1px solid #ddd">
        <div style="font-size:11px;font-weight:bold;color:#1a3a2a;letter-spacing:1px">TERRA FIRMA PARTNERS</div>
        <div style="font-size:10px;color:#888">terrafirma.partners | Terrain Intelligence for Serious Hunters</div>
      </div>
    </div>
    <div style="margin-top:16px;font-size:10px;color:#ccc;letter-spacing:2px">Report ID: ${reportId}</div>
  </div>
</div>

</body>
</html>`;
}