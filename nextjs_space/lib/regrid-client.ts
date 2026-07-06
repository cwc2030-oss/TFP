/**
 * Regrid API Client Wrapper
 * 
 * ALL Regrid API calls MUST go through this module.
 * It handles:
 *  1. Logging every outbound call with [REGRID-CALL] tag
 *  2. Incrementing a daily counter in the RegridUsage table
 *  3. Firing an email alert if the daily total exceeds DAILY_ALERT_THRESHOLD
 */

import { prisma } from "@/lib/db";

const DAILY_ALERT_THRESHOLD = 800;
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // Only alert once per 6 hours
let lastAlertSentAt = 0;

/**
 * Thin wrapper around fetch() for Regrid API calls.
 * Logs, counts, and optionally alerts on threshold breach.
 *
 * @param url     Full Regrid URL (with token)
 * @param tag     Short label for the call site, e.g. "parcels-lookup", "parcels-neighbors-v2"
 * @param options Optional fetch RequestInit (headers, signal, etc.)
 */
export async function regridFetch(
  url: string,
  tag: string,
  options?: RequestInit
): Promise<Response> {
  const safeUrl = url.replace(/token=[^&]+/, 'token=***');
  console.log(`[REGRID-CALL] ${tag} ${safeUrl}`);

  // Fire the actual request immediately — don't let counting delay the response
  const responsePromise = fetch(url, options);

  // Increment counter in the background (fire-and-forget)
  incrementUsage(tag).catch((err) =>
    console.error('[REGRID-USAGE] Counter increment failed:', err)
  );

  return responsePromise;
}

/**
 * Increment the daily call counter for a given endpoint tag.
 * Uses upsert so the row is created on first call of the day.
 * After incrementing, checks if the daily total exceeds the threshold.
 */
async function incrementUsage(tag: string): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  try {
    const updated = await prisma.regridUsage.upsert({
      where: {
        date_endpointTag: {
          date: today,
          endpointTag: tag,
        },
      },
      update: {
        callCount: { increment: 1 },
      },
      create: {
        date: today,
        endpointTag: tag,
        callCount: 1,
      },
    });

    // Check daily total across all tags (only if this tag just crossed a round number to avoid checking every call)
    if (updated.callCount % 50 === 0) {
      await checkDailyTotal(today);
    }
  } catch (err) {
    // Non-fatal — don't break the actual API call
    console.error('[REGRID-USAGE] DB upsert error:', err);
  }
}

/**
 * Sum all endpoint tags for today and send alert if over threshold.
 */
async function checkDailyTotal(today: Date): Promise<void> {
  try {
    const rows = await prisma.regridUsage.findMany({
      where: { date: today },
      select: { endpointTag: true, callCount: true },
    });

    const total = rows.reduce((sum, r) => sum + r.callCount, 0);

    if (total >= DAILY_ALERT_THRESHOLD && Date.now() - lastAlertSentAt > ALERT_COOLDOWN_MS) {
      lastAlertSentAt = Date.now();
      await sendUsageAlert(today, rows, total);
    }
  } catch (err) {
    console.error('[REGRID-USAGE] Daily total check error:', err);
  }
}

/**
 * Send email alert with breakdown by endpoint tag.
 */
async function sendUsageAlert(
  date: Date,
  rows: { endpointTag: string; callCount: number }[],
  total: number
): Promise<void> {
  const dateStr = date.toISOString().slice(0, 10);
  const breakdown = rows
    .sort((a, b) => b.callCount - a.callCount)
    .map((r) => `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;">${r.endpointTag}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${r.callCount.toLocaleString()}</td></tr>`)
    .join('');

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#dc2626;border-bottom:2px solid #dc2626;padding-bottom:10px;">
        ⚠ Regrid API Usage Alert — ${dateStr}
      </h2>
      <p style="font-size:16px;">Daily Regrid API calls have reached <strong>${total.toLocaleString()}</strong>, exceeding the ${DAILY_ALERT_THRESHOLD} threshold.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:8px 12px;text-align:left;">Endpoint Tag</th>
            <th style="padding:8px 12px;text-align:right;">Calls</th>
          </tr>
        </thead>
        <tbody>
          ${breakdown}
          <tr style="background:#fef2f2;">
            <td style="padding:8px 12px;font-weight:700;">TOTAL</td>
            <td style="padding:8px 12px;text-align:right;font-weight:700;color:#dc2626;">${total.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
      <p style="color:#666;font-size:13px;">This alert fires once per 6 hours. Review usage at /api/admin/regrid-usage.</p>
    </div>
  `;

  try {
    const appUrl = process.env.NEXTAUTH_URL || '';
    const appName = appUrl ? new URL(appUrl).hostname.split('.')[0] : 'TerraFirma';

    const resp = await fetch('https://apps.abacus.ai/api/sendNotificationEmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deployment_token: process.env.ABACUSAI_API_KEY,
        app_id: process.env.WEB_APP_ID,
        notification_id: process.env.NOTIF_ID_REGRID_API_USAGE_ALERT,
        subject: `⚠ Regrid API: ${total} calls today (${dateStr})`,
        body: htmlBody,
        is_html: true,
        recipient_email: process.env.ADMIN_EMAIL || 'clark@terrafirma.partners',
        sender_email: `noreply@${appUrl ? new URL(appUrl).hostname : 'terrafirma.partners'}`,
        sender_alias: appName,
      }),
    });

    const result = await resp.json();
    if (result.success) {
      console.log(`[REGRID-USAGE] Alert email sent: ${total} calls on ${dateStr}`);
    } else {
      console.error('[REGRID-USAGE] Alert email failed:', result);
    }
  } catch (err) {
    console.error('[REGRID-USAGE] Alert email error:', err);
  }
}

/**
 * Get usage stats for a date range (used by admin endpoint).
 */
export async function getRegridUsageStats(
  startDate: Date,
  endDate: Date
): Promise<{ date: string; endpointTag: string; callCount: number }[]> {
  const rows = await prisma.regridUsage.findMany({
    where: {
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: [{ date: 'desc' }, { callCount: 'desc' }],
    select: { date: true, endpointTag: true, callCount: true },
  });

  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    endpointTag: r.endpointTag,
    callCount: r.callCount,
  }));
}
