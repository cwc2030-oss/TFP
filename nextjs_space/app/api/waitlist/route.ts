/**
 * POST /api/waitlist
 *
 * Public, no auth required. Captures email + side + minimal profile into
 * Waitlist. Idempotent on (email, side):
 *   - new          → 201 + { id, mode: "created" }
 *   - existing     → 200 + { id, mode: "updated" } (non-null fields merged)
 *
 * UTMs: read from body OR from the `referer` header query string OR
 * from the standard utm_* query params attached to this POST URL
 * (the page can append them to the action URL if it wants).
 *
 * No precise-location fields. Listings opsec rules also apply here:
 * we never accept lat/lng in this endpoint.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { waitlistInputSchema, nonNullDelta } from '@/lib/waitlist';

export const dynamic = 'force-dynamic';

function extractUtmsFromUrl(rawUrl: string | null | undefined) {
  if (!rawUrl) return {};
  try {
    const u = new URL(rawUrl);
    const get = (k: string) => u.searchParams.get(k) || undefined;
    return {
      utmSource: get('utm_source'),
      utmMedium: get('utm_medium'),
      utmCampaign: get('utm_campaign'),
    };
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const parsed = waitlistInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // UTM fallback chain: body → request URL → referer header.
  // Body wins if explicitly set; otherwise we infer from the request.
  const fromRequestUrl = extractUtmsFromUrl(req.url);
  const fromReferer = extractUtmsFromUrl(req.headers.get('referer'));
  const utms = {
    utmSource: parsed.data.utmSource ?? fromRequestUrl.utmSource ?? fromReferer.utmSource,
    utmMedium: parsed.data.utmMedium ?? fromRequestUrl.utmMedium ?? fromReferer.utmMedium,
    utmCampaign:
      parsed.data.utmCampaign ?? fromRequestUrl.utmCampaign ?? fromReferer.utmCampaign,
  };

  const merged = { ...parsed.data, ...utms };

  // Idempotent (email, side): findFirst on the natural pair, update on hit,
  // create on miss. We don't enforce a DB unique on (email, side) so users
  // can intentionally sign up to BOTH sides.
  const existing = await prisma.waitlist.findFirst({
    where: { email: merged.email, side: merged.side },
    select: { id: true },
  });

  if (existing) {
    const delta = nonNullDelta(merged);
    if (Object.keys(delta).length > 0) {
      await prisma.waitlist.update({
        where: { id: existing.id },
        data: delta,
      });
    }
    return NextResponse.json(
      { id: existing.id, mode: 'updated' },
      { status: 200 },
    );
  }

  const created = await prisma.waitlist.create({
    data: {
      side: merged.side,
      email: merged.email,
      name: merged.name,
      state: merged.state,
      states: merged.states ?? [],
      acres: merged.acres,
      maxBudgetUsd: merged.maxBudgetUsd,
      seasonInterest: merged.seasonInterest ?? [],
      groupSize: merged.groupSize,
      source: merged.source,
      utmSource: merged.utmSource,
      utmMedium: merged.utmMedium,
      utmCampaign: merged.utmCampaign,
      notes: merged.notes,
    },
    select: { id: true },
  });

  return NextResponse.json(
    { id: created.id, mode: 'created' },
    { status: 201 },
  );
}
