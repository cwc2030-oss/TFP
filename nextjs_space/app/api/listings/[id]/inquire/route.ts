/**
 * POST /api/listings/[id]/inquire — PUBLIC, no auth.
 *
 * Chunk 4: hunter inquiry submission.
 *
 * Behavior contract:
 *   - 404 unless listing exists AND status === PUBLISHED
 *     (do NOT leak DRAFT/PENDING_REVIEW/LEASED/WITHDRAWN existence)
 *   - 400 on .strict() validation failure
 *   - 200 + { ok: true } silently if honeypot is filled (drop, no DB write)
 *   - 429 with Retry-After if same ipHash submitted >3 inquiries in last hour
 *   - 200 + existing inquiry if same (listingId, hunterEmail) within 7d window
 *     (idempotent; emails NOT re-fired)
 *   - 200 + { ok: true, inquiryId } on real new submission. Emails fired:
 *       - Landowner: To Listing.contactEmail || User.email; BCC INQUIRY_BCC
 *       - Hunter:    To input.hunterEmail (single-recipient confirmation)
 *
 * Email failures are logged but do NOT 500 the inquiry — we still wrote
 * the row, the dashboard will show it, and Clark/the landowner can reach
 * out manually.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  inquiryInputSchema,
  ipHash as hashIp,
  resolveClientIp,
  buildLandownerEmail,
  buildHunterConfirmationEmail,
  IDEMPOTENCY_WINDOW_MS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  type EmailListingContext,
} from '@/lib/inquiry';
import { sendEmail } from '@/lib/email';
import { listingSlug } from '@/lib/listings';

export const dynamic = 'force-dynamic';

function appUrl(): string {
  return process.env.NEXTAUTH_URL || 'https://terrafirma.partners';
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  // ---------------------------------------------------------------------
  // Parse + validate
  // ---------------------------------------------------------------------
  const json = await req.json().catch(() => null);
  if (!json || typeof json !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = inquiryInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Honeypot — silent drop. We log so we can monitor but never write a row.
  if (data.website && data.website.trim().length > 0) {
    console.log('[inquiry] honeypot triggered, dropping silently', {
      listingId: params.id,
      hunterEmail: data.hunterEmail,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // ---------------------------------------------------------------------
  // Listing must exist AND be PUBLISHED. Anything else → 404 (no leak).
  // ---------------------------------------------------------------------
  const listing = await prisma.listing.findFirst({
    where: { id: params.id, status: 'PUBLISHED' },
    include: {
      owner: { select: { email: true, name: true } },
    },
  });
  if (!listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }

  // ---------------------------------------------------------------------
  // Rate limit by ipHash: max 3 per hour
  // ---------------------------------------------------------------------
  const clientIp = resolveClientIp(req.headers);
  const ipHashValue = hashIp(clientIp);
  if (ipHashValue) {
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recent = await prisma.inquiry.count({
      where: { ipHash: ipHashValue, createdAt: { gte: since } },
    });
    if (recent >= RATE_LIMIT_MAX) {
      const retryAfterSec = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
      return NextResponse.json(
        { error: 'Too many inquiries. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSec) },
        },
      );
    }
  }

  // ---------------------------------------------------------------------
  // Idempotency: same (listingId, hunterEmail) within 7d → reuse row.
  // ---------------------------------------------------------------------
  const idempotencyCutoff = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
  const existing = await prisma.inquiry.findFirst({
    where: {
      listingId: listing.id,
      hunterEmail: data.hunterEmail,
      createdAt: { gte: idempotencyCutoff },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    return NextResponse.json(
      { ok: true, inquiryId: existing.id, idempotent: true },
      { status: 200 },
    );
  }

  // ---------------------------------------------------------------------
  // Capture userId if caller is signed in (enables accepted-lessee gate).
  // ---------------------------------------------------------------------
  const session = await getServerSession(authOptions);
  const callerUserId = session?.user?.id ?? null;

  // ---------------------------------------------------------------------
  // Create the inquiry row.
  // ---------------------------------------------------------------------
  const inquiry = await prisma.inquiry.create({
    data: {
      listingId: listing.id,
      userId: callerUserId,
      hunterName: data.hunterName,
      hunterEmail: data.hunterEmail,
      hunterPhone: data.hunterPhone ?? null,
      preferredDates: data.preferredDates ?? null,
      partySize: data.partySize,
      message: data.message,
      source: data.source ?? 'listing_detail',
      utmSource: data.utmSource ?? null,
      utmMedium: data.utmMedium ?? null,
      utmCampaign: data.utmCampaign ?? null,
      ipHash: ipHashValue,
      status: 'NEW',
    },
  });

  // ---------------------------------------------------------------------
  // Resolve landowner inbox: Listing.contactEmail → User.email → warn+skip
  // ---------------------------------------------------------------------
  const landownerEmail =
    (listing.contactEmail && listing.contactEmail.trim().length > 0
      ? listing.contactEmail
      : null) ?? listing.owner.email ?? null;

  if (!landownerEmail) {
    console.warn(
      `[inquiry] WARNING: listing ${listing.id} has neither contactEmail nor owner.email; ` +
        `inquiry ${inquiry.id} stored but landowner email NOT sent. ` +
        `Inquiry remains visible in the dashboard.`,
    );
  }

  // ---------------------------------------------------------------------
  // Build email context (state/county/acres/lease/price ONLY — no precise
  // location, ever).
  // ---------------------------------------------------------------------
  const emailListing: EmailListingContext = {
    state: listing.state,
    county: listing.county,
    acres: listing.acres,
    askingPriceMin: listing.askingPriceMin,
    askingPriceMax: listing.askingPriceMax,
    leaseType: listing.leaseType,
  };

  // ---------------------------------------------------------------------
  // Fire emails. Failures are logged but do NOT 500 the request.
  // ---------------------------------------------------------------------
  const inboxUrl = `${appUrl().replace(/\/$/, '')}/dashboard/inquiries`;

  // Landowner email
  if (landownerEmail) {
    const { subject, html } = buildLandownerEmail({
      inquiryId: inquiry.id,
      listing: emailListing,
      hunter: {
        name: data.hunterName,
        email: data.hunterEmail,
        phone: data.hunterPhone ?? null,
        preferredDates: data.preferredDates ?? null,
        partySize: data.partySize,
        message: data.message,
      },
      inboxUrl,
    });
    const bcc = process.env.INQUIRY_BCC || null;
    try {
      const results = await sendEmail({
        to: landownerEmail,
        bcc,
        replyTo: data.hunterEmail,
        subject,
        html,
      });
      const failures = results.filter((r) => !r.ok);
      if (failures.length > 0) {
        console.error('[inquiry] landowner email failures', {
          inquiryId: inquiry.id,
          failures,
        });
      }
    } catch (err) {
      console.error('[inquiry] landowner email threw', { inquiryId: inquiry.id, err });
    }
  }

  // Hunter confirmation
  try {
    const { subject, html } = buildHunterConfirmationEmail({
      listing: emailListing,
      hunter: {
        name: data.hunterName,
        partySize: data.partySize,
        preferredDates: data.preferredDates ?? null,
        message: data.message,
      },
    });
    const results = await sendEmail({
      to: data.hunterEmail,
      subject,
      html,
    });
    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
      console.error('[inquiry] hunter confirmation failures', {
        inquiryId: inquiry.id,
        failures,
      });
    }
  } catch (err) {
    console.error('[inquiry] hunter email threw', { inquiryId: inquiry.id, err });
  }

  // Build canonical slug for the GA4 event payload (cosmetic only).
  const slug = listingSlug({
    state: listing.state,
    county: listing.county,
    acres: listing.acres,
    terrainScore: listing.terrainScore,
    leaseType: listing.leaseType,
  });

  return NextResponse.json(
    { ok: true, inquiryId: inquiry.id, slug },
    { status: 200 },
  );
}

// We deliberately don't export GET / DELETE / PATCH from this route. The
// only public surface is POST. The owner-side status management lives at
// /api/dashboard/inquiries/[id]/status.
export function GET(): Response {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405 });
}

// satisfy unused import lint
void Prisma;
