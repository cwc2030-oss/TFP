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
