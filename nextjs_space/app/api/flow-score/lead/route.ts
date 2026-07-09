export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * POST /api/flow-score/lead
 *
 * Creates a Lead record from an email gate. Reused by both the /flow-score
 * page (source: 'flow_score') and the Terrain Brain aha-moment capture
 * (source: 'terrain_brain_aha'). The `source` field lets us tell these
 * captures apart in the funnel.
 * Body: { email, address?, lat?, lng?, county?, state?, teaserScore?, alertCounty?, source? }
 * Returns: { leadId }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, address, lat, lng, county, state, teaserScore, alertCounty, source } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    // Only accept known sources; default to the original flow-score gate.
    const allowedSources = ['flow_score', 'terrain_brain_aha'];
    const leadSource = allowedSources.includes(source) ? source : 'flow_score';

    const normalizedEmail = email.trim().toLowerCase();

    // Upsert: if this email already captured a lead for the same address, update it
    // Otherwise create a new one. We use findFirst + create/update to handle this
    // since we don't have a unique constraint on email+address.
    const existingLead = await prisma.lead.findFirst({
      where: {
        email: normalizedEmail,
        source: leadSource,
        ...(lat != null && lng != null
          ? {
              lat: { gte: lat - 0.0001, lte: lat + 0.0001 },
              lng: { gte: lng - 0.0001, lte: lng + 0.0001 },
            }
          : address
            ? { address }
            : {}),
      },
      select: { id: true },
    });

    let leadId: string;

    if (existingLead) {
      // Update with latest info (county alert opt-in might have changed)
      await prisma.lead.update({
        where: { id: existingLead.id },
        data: {
          alertCounty: alertCounty === true,
          county: county || undefined,
          state: state || undefined,
          teaserScore: teaserScore ?? undefined,
        },
      });
      leadId = existingLead.id;
    } else {
      const lead = await prisma.lead.create({
        data: {
          email: normalizedEmail,
          address: address || null,
          lat: lat ?? null,
          lng: lng ?? null,
          county: county || null,
          state: state || null,
          teaserScore: teaserScore ?? null,
          source: leadSource,
          alertCounty: alertCounty === true,
        },
      });
      leadId = lead.id;
    }

    console.log('[flow-score/lead] Lead captured:', {
      leadId,
      email: normalizedEmail,
      source: leadSource,
      address: address || '(none)',
      county: county || '(none)',
      alertCounty: alertCounty === true,
      isUpdate: !!existingLead,
    });

    // ── Best-effort confirmation email ──────────────────────────────────────
    // Fulfills the card's promise ("full terrain report + county lease alerts").
    // The lead is ALREADY saved above; email is best-effort and never blocks the
    // capture. Reuses the existing Abacus sendNotificationEmail infrastructure.
    try {
      await sendFlowScoreConfirmation({
        email: normalizedEmail,
        address: address || null,
        lat: typeof lat === 'number' ? lat : null,
        lng: typeof lng === 'number' ? lng : null,
        county: county || null,
        teaserScore: typeof teaserScore === 'number' ? teaserScore : null,
        alertCounty: alertCounty === true,
      });
    } catch (mailErr: any) {
      // Swallow — capture is guaranteed, email is best-effort.
      console.error('[flow-score/lead] Confirmation email failed (lead still saved):', mailErr?.message);
    }

    return NextResponse.json({ leadId });
  } catch (err: any) {
    console.error('[flow-score/lead] Error:', err.message);
    return NextResponse.json({ error: 'Failed to capture lead' }, { status: 500 });
  }
}

/**
 * Sends the warm, on-brand confirmation email to a freshly captured lead.
 * Best-effort: throws on hard failure (caller swallows it so the capture stands).
 */
async function sendFlowScoreConfirmation(lead: {
  email: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  county: string | null;
  teaserScore: number | null;
  alertCounty: boolean;
}) {
  const appUrl = process.env.NEXTAUTH_URL || 'https://terrafirma.partners';
  // Send from a terrafirma.partners address; route replies to Clark.
  const senderEmail = 'noreply@terrafirma.partners';
  const replyTo = process.env.ADMIN_EMAIL || 'clark@terrafirma.partners';

  const parcelLabel = lead.address || 'your parcel';
  // Link back to the exact parcel on the Terrain Brain page when we have coords.
  const params = new URLSearchParams();
  if (lead.lat != null && lead.lng != null) {
    params.set('lat', String(lead.lat));
    params.set('lng', String(lead.lng));
  }
  if (lead.address) params.set('address', lead.address);
  const intelLink = params.toString() ? `${appUrl}/intel?${params.toString()}` : `${appUrl}/intel`;

  const scoreBlock = lead.teaserScore != null
    ? `
            <div style="text-align:center; margin: 4px 0 24px 0;">
              <div style="display:inline-block; background:#0d1f17; border:1px solid #c9a84c55; border-radius:14px; padding:18px 34px;">
                <div style="color:#c9a84c; font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin-bottom:6px;">Your Flow Score</div>
                <div style="color:#f4efe2; font-size:44px; font-weight:800; line-height:1;">${Math.round(lead.teaserScore)}<span style="color:#8a9a8f; font-size:20px; font-weight:600;">/100</span></div>
              </div>
            </div>`
    : '';

  const alertBlock = lead.alertCounty
    ? `
            <div style="background:#0d1f17; border:1px solid #c9a84c55; border-radius:10px; padding:16px 18px; margin-top:22px;">
              <p style="color:#c9a84c; margin:0 0 6px 0; font-size:14px; font-weight:700;">✓ County lease alerts are ON</p>
              <p style="color:#cfd8d0; margin:0; font-size:13px; line-height:1.5;">
                We'll email you the moment new leases hit ${lead.county ? `<strong style="color:#f4efe2;">${lead.county} County</strong>` : 'your county'}. No noise — just the drops that matter.
              </p>
            </div>`
    : '';

  const htmlBody = `
    <div style="font-family:'Segoe UI', Arial, sans-serif; max-width:600px; margin:0 auto; background:#12271c;">
      <div style="background:linear-gradient(135deg,#0d1f17 0%,#1a3a2a 100%); padding:30px; text-align:center; border-bottom:2px solid #c9a84c;">
        <h1 style="color:#f4efe2; margin:0; font-size:22px; letter-spacing:0.5px;">Terrain Brain™</h1>
        <p style="color:#c9a84c; margin:8px 0 0 0; font-size:13px; font-style:italic; letter-spacing:1px;">Your land. Decoded.</p>
      </div>
      <div style="padding:30px; background:#16302280;">
        <h2 style="color:#f4efe2; margin:0 0 14px 0; font-size:19px;">Your Flow Score is saved.</h2>
        <p style="color:#cfd8d0; margin:0 0 20px 0; font-size:14px; line-height:1.6;">
          Thanks for reading the terrain on <strong style="color:#f4efe2;">${parcelLabel}</strong>. Here's the snapshot the Terrain Brain™ pulled — the deer-flow read that most hunters never get to see.
        </p>
        ${scoreBlock}
        <div style="text-align:center; margin:24px 0;">
          <a href="${intelLink}" style="display:inline-block; background:linear-gradient(135deg,#c9a84c,#a88a30); color:#0d1f17; padding:14px 30px; text-decoration:none; border-radius:8px; font-weight:700; font-size:15px;">View your full terrain read</a>
        </div>
        <p style="color:#8a9a8f; margin:0; font-size:13px; line-height:1.6; text-align:center;">
          Open your parcel again anytime to explore the ridges, funnels, and flow lines in full.
        </p>
        ${alertBlock}
      </div>
      <div style="padding:22px; text-align:center; background:#0d1f17;">
        <p style="color:#c9a84c; margin:0; font-size:13px; font-weight:600;">Terra Firma Partners</p>
        <p style="color:#6f7f74; margin:6px 0 0 0; font-size:11px;">Terrain-derived land intelligence for hunters and landowners.</p>
        <p style="color:#6f7f74; margin:6px 0 0 0; font-size:11px;">Questions? Just reply — this reaches Clark directly.</p>
      </div>
    </div>
  `;

  const res = await fetch('https://apps.abacus.ai/api/sendNotificationEmail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deployment_token: process.env.ABACUSAI_API_KEY,
      app_id: process.env.WEB_APP_ID,
      notification_id: process.env.NOTIF_ID_FLOW_SCORE_CONFIRMATION,
      subject: lead.teaserScore != null
        ? `Your Flow Score: ${Math.round(lead.teaserScore)}/100 — ${parcelLabel}`
        : `Your terrain read — ${parcelLabel}`,
      body: htmlBody,
      is_html: true,
      recipient_email: lead.email,
      reply_to: replyTo,
      sender_email: senderEmail,
      sender_alias: 'Clark Colwell — Terra Firma Partners',
    }),
  });

  const result = await res.json().catch(() => ({}));
  if (!result?.success && !result?.notification_disabled) {
    throw new Error(`sendNotificationEmail failed: ${JSON.stringify(result)}`);
  }
  console.log('[flow-score/lead] Confirmation email sent to', lead.email, 'result:', result?.success ? 'ok' : 'disabled');
}
