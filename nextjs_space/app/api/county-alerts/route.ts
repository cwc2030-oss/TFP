export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { normalizeCounty } from '@/lib/county-flow';

/**
 * County Flow Alerts — free email capture.
 *
 * "Get alerted when a high-flow parcel lists in [county]." Turns top-of-funnel
 * (Facebook) traffic into an owned list BEFORE the marketplace opens.
 *
 * Reuses the Lead model (source='county_alert', alertCounty=true) so these
 * signups live alongside flow-score leads and can be exported together.
 *
 * POST body: { email, county, state, source? }
 * GET: { count } — total county-alert subscribers (for social proof).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const county = normalizeCounty(body.county);
    const state = typeof body.state === 'string' ? body.state.toUpperCase().trim() : '';
    const source = typeof body.source === 'string' ? body.source.slice(0, 60) : 'county_alert';

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }
    if (!county || !/^[A-Z]{2}$/.test(state)) {
      return NextResponse.json({ error: 'A valid county and state are required' }, { status: 400 });
    }

    // De-dupe: one alert subscription per email+county+state.
    const existing = await prisma.lead.findFirst({
      where: { email, county, state, source: 'county_alert' },
      select: { id: true },
    });

    if (existing) {
      await prisma.lead.update({
        where: { id: existing.id },
        data: { alertCounty: true },
      });
      return NextResponse.json({ ok: true, alreadySubscribed: true });
    }

    await prisma.lead.create({
      data: {
        email,
        county,
        state,
        source: 'county_alert',
        alertCounty: true,
      },
    });

    console.log('[county-alerts] new subscriber:', { email, county, state, source });
    return NextResponse.json({ ok: true, alreadySubscribed: false });
  } catch (e) {
    console.error('[county-alerts] POST error:', e);
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const count = await prisma.lead.count({ where: { source: 'county_alert', alertCounty: true } });
    return NextResponse.json({ count });
  } catch (e) {
    console.error('[county-alerts] GET error:', e);
    return NextResponse.json({ count: 0 });
  }
}
