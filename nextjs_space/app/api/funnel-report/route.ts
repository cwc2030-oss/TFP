import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/* ────────────── helpers ────────────────────────────────────────── */

const FUNNEL_STEPS = [
  { step: 'Address Searched', event: 'address_search' },
  { step: 'Terrain Analyzer Opened', event: 'terrain_analyzer_opened' },
  { step: 'Pricing Page Viewed', event: 'pricing_page_viewed' },
  { step: 'Checkout Initiated', event: 'checkout_initiated' },
  { step: 'Purchase Completed', event: 'purchase_completed' },
] as const;

/** Map internal product types to friendly display names */
const PRODUCT_LABELS: Record<string, string> = {
  parcel_unlock: '$19 Parcel Unlock',
  hunt_report: '$19 Parcel Unlock',   // legacy name for same product
  land_report: '$19 Parcel Unlock',   // legacy name
  pro: '$99 Pro',
  pro_max: '$199 Pro Max',
};

async function getEventCounts(since: Date, until: Date) {
  const events = await prisma.funnelEvent.groupBy({
    by: ['event'],
    _count: { id: true },
    where: { createdAt: { gte: since, lt: until } },
  });
  const map: Record<string, number> = {};
  events.forEach((e: { event: string; _count: { id: number } }) => {
    map[e.event] = e._count.id;
  });
  return map;
}

async function getPurchaseBreakdown(since: Date, until: Date) {
  const purchases = await prisma.funnelEvent.findMany({
    where: { event: 'purchase_completed', createdAt: { gte: since, lt: until } },
    select: { metadata: true },
  });
  const breakdown: Record<string, number> = {};
  purchases.forEach((p: { metadata: string | null }) => {
    try {
      const m = JSON.parse(p.metadata || '{}');
      const raw = m.productType || 'unknown';
      const label = PRODUCT_LABELS[raw] || raw;
      breakdown[label] = (breakdown[label] || 0) + 1;
    } catch {
      breakdown['unknown'] = (breakdown['unknown'] || 0) + 1;
    }
  });
  return breakdown;
}

function pct(n: number, d: number): string {
  if (d === 0) return '—';
  return ((n / d) * 100).toFixed(1) + '%';
}

function delta(cur: number, prev: number): string {
  const diff = cur - prev;
  const sign = diff >= 0 ? '+' : '';
  if (prev === 0 && cur === 0) return '—';
  const pctChange = prev > 0 ? ` (${sign}${Math.round((diff / prev) * 100)}%)` : cur > 0 ? ' (new)' : '';
  return `${sign}${diff}${pctChange}`;
}

function arrow(cur: number, prev: number): string {
  if (cur > prev) return '▲';
  if (cur < prev) return '▼';
  return '—';
}

function arrowColor(cur: number, prev: number): string {
  if (cur > prev) return '#22c55e';
  if (cur < prev) return '#ef4444';
  return '#94a3b8';
}

/* ────────────── build HTML email ───────────────────────────────── */

function buildEmailHtml(
  now: Date,
  curMap: Record<string, number>,
  prevMap: Record<string, number>,
  curBreakdown: Record<string, number>,
  prevBreakdown: Record<string, number>,
) {
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(thisWeekStart.getDate() - 7);

  const topCur = curMap['address_search'] || 0;
  const bottomCur = curMap['purchase_completed'] || 0;
  const topPrev = prevMap['address_search'] || 0;
  const bottomPrev = prevMap['purchase_completed'] || 0;

  const overallCur = topCur > 0 ? ((bottomCur / topCur) * 100).toFixed(2) : '0.00';
  const overallPrev = topPrev > 0 ? ((bottomPrev / topPrev) * 100).toFixed(2) : '0.00';

  // Build step rows
  let stepsHtml = '';
  for (let i = 0; i < FUNNEL_STEPS.length; i++) {
    const s = FUNNEL_STEPS[i];
    const cur = curMap[s.event] || 0;
    const prev = prevMap[s.event] || 0;
    const prevStepCur = i > 0 ? (curMap[FUNNEL_STEPS[i - 1].event] || 0) : cur;
    const dropoffStr = i === 0 ? '' : `↓ ${pct(prevStepCur - cur, prevStepCur)} drop-off`;
    const a = arrow(cur, prev);
    const ac = arrowColor(cur, prev);
    const d = delta(cur, prev);

    stepsHtml += `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:12px 8px;font-size:14px;color:#1f2937;">
          <strong>${i + 1}. ${s.step}</strong>
          ${dropoffStr ? `<br><span style="font-size:12px;color:#ef4444;">${dropoffStr}</span>` : ''}
        </td>
        <td style="padding:12px 8px;text-align:right;font-size:18px;font-weight:700;color:#1f2937;">
          ${cur.toLocaleString()}
        </td>
        <td style="padding:12px 8px;text-align:right;font-size:13px;color:${ac};">
          ${a} ${d}
        </td>
      </tr>`;
  }

  // Purchase breakdown
  let breakdownHtml = '';
  const allProducts = new Set([...Object.keys(curBreakdown), ...Object.keys(prevBreakdown)]);
  if (allProducts.size > 0) {
    breakdownHtml = `
      <div style="margin-top:24px;">
        <h3 style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Purchases by Product</h3>
        <table style="width:100%;border-collapse:collapse;">`;
    for (const product of allProducts) {
      const c = curBreakdown[product] || 0;
      const p = prevBreakdown[product] || 0;
      breakdownHtml += `
          <tr style="border-bottom:1px solid #f3f4f6;">
            <td style="padding:8px;font-size:13px;color:#374151;">${product}</td>
            <td style="padding:8px;text-align:right;font-size:14px;font-weight:600;">${c}</td>
            <td style="padding:8px;text-align:right;font-size:12px;color:${arrowColor(c, p)};">${arrow(c, p)} ${delta(c, p)}</td>
          </tr>`;
    }
    breakdownHtml += '</table></div>';
  }

  const dateRange = `${thisWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1c1917 0%,#292524 100%);padding:24px 24px 20px;">
      <h1 style="margin:0;font-size:20px;color:#ffffff;">🎯 Weekly Funnel Report</h1>
      <p style="margin:6px 0 0;font-size:13px;color:#a8a29e;">${dateRange} · TerraFirma Partners</p>
    </div>

    <div style="padding:20px 24px 28px;">

      <!-- Overall conversion -->
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:12px;color:#166534;text-transform:uppercase;letter-spacing:0.05em;">Overall Conversion</div>
          <div style="font-size:11px;color:#4ade80;margin-top:2px;">Address Search → Purchase</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:22px;font-weight:800;color:#166534;">${overallCur}%</div>
          <div style="font-size:11px;color:${arrowColor(parseFloat(overallCur), parseFloat(overallPrev))};">
            prev ${overallPrev}%
          </div>
        </div>
      </div>

      <!-- Funnel steps -->
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:2px solid #e5e7eb;">
            <th style="padding:8px;text-align:left;font-size:11px;color:#9ca3af;text-transform:uppercase;">Step</th>
            <th style="padding:8px;text-align:right;font-size:11px;color:#9ca3af;text-transform:uppercase;">Count</th>
            <th style="padding:8px;text-align:right;font-size:11px;color:#9ca3af;text-transform:uppercase;">vs Prev 7d</th>
          </tr>
        </thead>
        <tbody>
          ${stepsHtml}
        </tbody>
      </table>

      ${breakdownHtml}

    </div>

    <!-- Footer -->
    <div style="background:#fafaf9;padding:14px 24px;border-top:1px solid #e7e5e4;">
      <p style="margin:0;font-size:11px;color:#a8a29e;text-align:center;">
        Auto-generated from FunnelEvent table · Sent Monday mornings
      </p>
    </div>

  </div>
</body>
</html>`;
}

/* ────────────── POST: Generate + send the weekly report ─────── */

export async function POST(request: NextRequest) {
  // Auth: internal secret only (called by daemon)
  const internalSecret = request.headers.get('x-internal-secret');
  if (internalSecret !== process.env.NEXTAUTH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const recipientEmail = body.recipientEmail || process.env.ADMIN_EMAIL || 'clark@terrafirma.partners';

    const now = new Date();
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(thisWeekStart.getDate() - 7);
    const prevWeekStart = new Date(thisWeekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);

    // Gather data
    const curMap = await getEventCounts(thisWeekStart, now);
    const prevMap = await getEventCounts(prevWeekStart, thisWeekStart);
    const curBreakdown = await getPurchaseBreakdown(thisWeekStart, now);
    const prevBreakdown = await getPurchaseBreakdown(prevWeekStart, thisWeekStart);

    // Build email
    const htmlBody = buildEmailHtml(now, curMap, prevMap, curBreakdown, prevBreakdown);

    const topCur = curMap['address_search'] || 0;
    const bottomCur = curMap['purchase_completed'] || 0;
    const overallPct = topCur > 0 ? ((bottomCur / topCur) * 100).toFixed(1) : '0';
    const dateRange = `${thisWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

    const appUrl = process.env.NEXTAUTH_URL || '';
    const hostname = appUrl ? new URL(appUrl).hostname : 'terrafirma.partners';
    const appName = 'TerraFirma';

    // Send via notification API
    const emailRes = await fetch('https://apps.abacus.ai/api/sendNotificationEmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deployment_token: process.env.ABACUSAI_API_KEY,
        app_id: process.env.WEB_APP_ID,
        notification_id: process.env.NOTIF_ID_WEEKLY_FUNNEL_REPORT,
        subject: `Funnel Report ${dateRange}: ${topCur} searches → ${bottomCur} purchases (${overallPct}%)`,
        body: htmlBody,
        is_html: true,
        recipient_email: recipientEmail,
        sender_email: `noreply@${hostname}`,
        sender_alias: appName,
      }),
    });

    const emailResult = await emailRes.json();
    if (!emailResult.success && !emailResult.notification_disabled) {
      console.error('[FunnelReport] Email send failed:', emailResult);
      return NextResponse.json({ error: 'Email send failed', details: emailResult }, { status: 500 });
    }

    console.log(`[FunnelReport] Sent weekly funnel report to ${recipientEmail}`);
    return NextResponse.json({
      ok: true,
      summary: {
        searches: topCur,
        purchases: bottomCur,
        overallConversion: overallPct + '%',
        period: dateRange,
      },
    });
  } catch (error) {
    console.error('[FunnelReport] Error:', error);
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}

// GET: Preview the report (admin only)
export async function GET(request: NextRequest) {
  const session = await (await import('next-auth')).getServerSession((await import('@/lib/auth-options')).authOptions);
  const isAdmin = (session?.user as any)?.role === 'admin';
  const internalSecret = request.headers.get('x-internal-secret');
  const isInternal = internalSecret === process.env.NEXTAUTH_SECRET;

  if (!isAdmin && !isInternal) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(thisWeekStart.getDate() - 7);
  const prevWeekStart = new Date(thisWeekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);

  const curMap = await getEventCounts(thisWeekStart, now);
  const prevMap = await getEventCounts(prevWeekStart, thisWeekStart);
  const curBreakdown = await getPurchaseBreakdown(thisWeekStart, now);
  const prevBreakdown = await getPurchaseBreakdown(prevWeekStart, thisWeekStart);

  const html = buildEmailHtml(now, curMap, prevMap, curBreakdown, prevBreakdown);
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
