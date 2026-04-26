/**
 * Inquiry helpers — chunk 4.
 *
 * - Zod schema for the public inquiry form (.strict())
 * - ipHash() for rate-limiting without ever storing raw IPs
 * - buildLandownerEmail(), buildHunterConfirmationEmail()
 *
 * Kept separate from app/api/listings/[id]/inquire/route.ts so the same
 * helpers are easy to import from tests.
 *
 * OPSEC: zod is .strict() so unknown fields like centroidLat are rejected
 * before the row is written. The email helpers never reference any
 * precise-location field on the listing — only state/county/acres.
 */
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Listing } from '@prisma/client';

// ---------------------------------------------------------------------------
// Zod schema (.strict() rejects unknown keys)
// ---------------------------------------------------------------------------
export const inquiryInputSchema = z
  .object({
    hunterName: z.string().trim().min(1, 'Name required').max(120),
    hunterEmail: z
      .string()
      .trim()
      .email('Valid email required')
      .max(254)
      .transform((v) => v.toLowerCase()),
    hunterPhone: z.string().trim().min(7).max(32).optional().nullable(),
    preferredDates: z.string().trim().max(200).optional().nullable(),
    partySize: z
      .number()
      .int('Party size must be a whole number')
      .min(1, 'Party size must be at least 1')
      .max(50, 'Party size must be 50 or fewer')
      .default(1),
    message: z
      .string()
      .trim()
      .min(20, 'Message must be at least 20 characters')
      .max(2000, 'Message must be 2000 characters or fewer'),

    source: z.string().trim().max(64).optional().nullable(),
    utmSource: z.string().trim().max(120).optional().nullable(),
    utmMedium: z.string().trim().max(120).optional().nullable(),
    utmCampaign: z.string().trim().max(120).optional().nullable(),

    // Honeypot. Real users don't fill this; bots typically do. Empty or
    // missing means valid; any non-empty string means "silently drop".
    website: z.string().max(500).optional().nullable(),
  })
  .strict();

export type InquiryInput = z.infer<typeof inquiryInputSchema>;

// ---------------------------------------------------------------------------
// IP hash (sha256 over IP + INQUIRY_IP_SALT). Never store raw IP.
// ---------------------------------------------------------------------------
export function ipHash(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt = process.env.INQUIRY_IP_SALT || '';
  return createHash('sha256').update(`${ip}|${salt}`).digest('hex');
}

/**
 * Resolve client IP from request headers.
 *
 * Production passes through Abacus reverse proxy + Vercel-style headers.
 * x-forwarded-for is most reliable; we take the LEFTMOST entry (the real
 * client). Falls back to x-real-ip, then null.
 */
export function resolveClientIp(headers: Headers): string | null {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const xri = headers.get('x-real-ip');
  if (xri) return xri.trim();
  return null;
}

// ---------------------------------------------------------------------------
// Pricing label (mirror of /listings/[slug] priceLabel — dollars/yr)
// ---------------------------------------------------------------------------
function priceLabel(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null && max == null) return 'Inquire';
  const fmt = (n: number) => `$${n.toLocaleString('en-US')}`;
  if (min != null && max != null) {
    return min === max ? `${fmt(min)}/yr` : `${fmt(min)} – ${fmt(max)}/yr`;
  }
  return `${fmt((min ?? max) as number)}/yr`;
}

// ---------------------------------------------------------------------------
// Email body builders
//
// Both bodies use the same brand colors as app/api/email-parcel/route.ts so
// the look stays consistent. Emerald-700 primary, stone neutrals.
// ---------------------------------------------------------------------------

export interface EmailListingContext {
  state: Listing['state'];
  county: Listing['county'];
  acres: Listing['acres'];
  askingPriceMin: Listing['askingPriceMin'];
  askingPriceMax: Listing['askingPriceMax'];
  leaseType: Listing['leaseType'];
  // Cosmetic slug-id used to build canonical /dashboard/inquiries link.
  // Caller is responsible for never including any precise-location data here.
}

export interface BuildLandownerEmailInput {
  inquiryId: string;
  listing: EmailListingContext;
  hunter: {
    name: string;
    email: string;
    phone?: string | null;
    preferredDates?: string | null;
    partySize: number;
    message: string;
  };
  inboxUrl: string; // absolute URL to /dashboard/inquiries
}

function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function landownerSubject(listing: EmailListingContext): string {
  const county = listing.county ?? 'Unknown County';
  const state = listing.state ?? '';
  return `New lease inquiry — ${county}${state ? `, ${state}` : ''}`;
}

export function buildLandownerEmail(input: BuildLandownerEmailInput): {
  subject: string;
  html: string;
} {
  const { listing, hunter, inboxUrl } = input;
  const subject = landownerSubject(listing);
  const acresLabel = listing.acres != null ? `${Math.round(listing.acres)} ac` : '—';
  const priceStr = priceLabel(listing.askingPriceMin, listing.askingPriceMax);
  const leaseStr = listing.leaseType ? listing.leaseType.replace(/_/g, ' ') : '—';
  const datesStr = hunter.preferredDates ?? '—';
  const phoneStr = hunter.phone ?? '—';

  const html = `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
    <div style="background: linear-gradient(135deg, #047857 0%, #064e3b 100%); padding: 28px 30px;">
      <h1 style="color: #ecfdf5; margin: 0; font-size: 22px;">New lease inquiry</h1>
      <p style="color: #a7f3d0; margin: 6px 0 0 0; font-size: 14px;">${esc(listing.county)}${
    listing.county && listing.state ? ', ' : ''
  }${esc(listing.state)} — ${esc(acresLabel)}</p>
    </div>
    <div style="padding: 28px 30px; background: white;">
      <p style="color: #1f2937; margin: 0 0 18px 0;">A hunter just submitted an inquiry on your Terra Firma Partners listing.</p>

      <table style="width: 100%; border-collapse: collapse; margin: 0 0 18px 0;">
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280; width: 35%;">Name</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-weight: 600;">${esc(
            hunter.name,
          )}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Email</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; color: #1f2937; font-weight: 600;"><a href="mailto:${esc(
            hunter.email,
          )}" style="color: #047857; text-decoration: none;">${esc(hunter.email)}</a></td>
        </tr>
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Phone</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; color: #1f2937;">${esc(phoneStr)}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Preferred dates</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; color: #1f2937;">${esc(datesStr)}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Party size</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; color: #1f2937;">${hunter.partySize}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #6b7280;">Lease terms</td>
          <td style="padding: 10px 0; color: #1f2937;">${esc(leaseStr)} — ${esc(priceStr)}</td>
        </tr>
      </table>

      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px 18px; margin-bottom: 22px;">
        <div style="color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px;">Message</div>
        <div style="color: #1f2937; font-size: 14px; white-space: pre-wrap; line-height: 1.55;">${esc(
          hunter.message,
        )}</div>
      </div>

      <div style="text-align: center; margin: 22px 0 6px 0;">
        <a href="${esc(inboxUrl)}" style="display: inline-block; background: #047857; color: white; padding: 12px 22px; text-decoration: none; border-radius: 6px; font-weight: 600;">Open inquiries dashboard</a>
      </div>
      <p style="color: #6b7280; font-size: 12px; margin: 16px 0 0 0;">Reply directly to ${esc(
        hunter.email,
      )} to start the conversation. Mark this inquiry as Replied or Closed in your dashboard once you've responded.</p>
    </div>
    <div style="padding: 18px 30px; background: #f3f4f6; text-align: center;">
      <p style="color: #6b7280; margin: 0; font-size: 12px;">Terra Firma Partners — hunt-lease intelligence</p>
    </div>
  </div>`;

  return { subject, html };
}

export interface BuildHunterEmailInput {
  listing: EmailListingContext;
  hunter: {
    name: string;
    partySize: number;
    preferredDates?: string | null;
    message: string;
  };
}

export function hunterSubject(listing: EmailListingContext): string {
  const county = listing.county ?? 'your selected lease';
  const state = listing.state ?? '';
  return `We forwarded your inquiry — ${county}${state ? `, ${state}` : ''}`;
}

export function buildHunterConfirmationEmail(input: BuildHunterEmailInput): {
  subject: string;
  html: string;
} {
  const { listing, hunter } = input;
  const subject = hunterSubject(listing);
  const acresLabel = listing.acres != null ? `${Math.round(listing.acres)} ac` : '';

  const html = `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb;">
    <div style="background: linear-gradient(135deg, #047857 0%, #064e3b 100%); padding: 28px 30px;">
      <h1 style="color: #ecfdf5; margin: 0; font-size: 22px;">Your inquiry is on its way</h1>
      <p style="color: #a7f3d0; margin: 6px 0 0 0; font-size: 14px;">${esc(listing.county)}${
    listing.county && listing.state ? ', ' : ''
  }${esc(listing.state)}${acresLabel ? ` — ${esc(acresLabel)}` : ''}</p>
    </div>
    <div style="padding: 28px 30px; background: white;">
      <p style="color: #1f2937; margin: 0 0 14px 0; font-size: 15px;">Hi ${esc(hunter.name)},</p>
      <p style="color: #1f2937; margin: 0 0 14px 0; font-size: 14px; line-height: 1.6;">
        Thanks for reaching out through Terra Firma Partners. We've forwarded your inquiry directly to the landowner. They'll reply to you in their own words, on their own timeline — typically within <strong>24–72 hours</strong>.
      </p>
      <p style="color: #1f2937; margin: 0 0 18px 0; font-size: 14px; line-height: 1.6;">
        The landowner has your name, email, phone (if provided), preferred dates, and your full message. There's no need to resubmit — a duplicate inquiry inside a 7-day window won't re-fire emails.
      </p>

      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px; margin-bottom: 22px;">
        <div style="color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px;">What you sent</div>
        <div style="color: #6b7280; font-size: 13px; margin-bottom: 4px;">Party size: <span style="color: #1f2937;">${
          hunter.partySize
        }</span>${
    hunter.preferredDates
      ? ` — Preferred dates: <span style="color: #1f2937;">${esc(hunter.preferredDates)}</span>`
      : ''
  }</div>
        <div style="color: #1f2937; font-size: 14px; white-space: pre-wrap; line-height: 1.55;">${esc(
          hunter.message,
        )}</div>
      </div>

      <p style="color: #1f2937; margin: 0 0 6px 0; font-size: 14px; line-height: 1.6;">
        A few quick notes:
      </p>
      <ul style="color: #1f2937; font-size: 14px; line-height: 1.7; margin: 0 0 18px 18px; padding: 0;">
        <li>Replies come <strong>directly from the landowner</strong>, not from Terra Firma Partners.</li>
        <li>Listings only display <strong>county-level location</strong> until you and the landowner are in contact.</li>
        <li>If a property gets leased before you hear back, the listing comes down automatically.</li>
      </ul>

      <p style="color: #6b7280; font-size: 12px; margin: 16px 0 0 0;">Good luck out there.</p>
    </div>
    <div style="padding: 18px 30px; background: #f3f4f6; text-align: center;">
      <p style="color: #6b7280; margin: 0; font-size: 12px;">Terra Firma Partners — hunt-lease intelligence</p>
    </div>
  </div>`;

  return { subject, html };
}

// ---------------------------------------------------------------------------
// Idempotency window: 7 days. Same (listingId, hunterEmail) inside this
// window returns the existing inquiry and does NOT re-fire emails.
// ---------------------------------------------------------------------------
export const IDEMPOTENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Rate limit: max 3 inquiries per hour per ipHash.
// ---------------------------------------------------------------------------
export const RATE_LIMIT_MAX = 3;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
