export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * POST /api/flow-score/lead
 *
 * Creates a Lead record from the flow-score email gate.
 * Body: { email, address?, lat?, lng?, county?, state?, teaserScore?, alertCounty? }
 * Returns: { leadId }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, address, lat, lng, county, state, teaserScore, alertCounty } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Upsert: if this email already captured a lead for the same address, update it
    // Otherwise create a new one. We use findFirst + create/update to handle this
    // since we don't have a unique constraint on email+address.
    const existingLead = await prisma.lead.findFirst({
      where: {
        email: normalizedEmail,
        source: 'flow_score',
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
          source: 'flow_score',
          alertCounty: alertCounty === true,
        },
      });
      leadId = lead.id;
    }

    console.log('[flow-score/lead] Lead captured:', {
      leadId,
      email: normalizedEmail,
      address: address || '(none)',
      county: county || '(none)',
      alertCounty: alertCounty === true,
      isUpdate: !!existingLead,
    });

    return NextResponse.json({ leadId });
  } catch (err: any) {
    console.error('[flow-score/lead] Error:', err.message);
    return NextResponse.json({ error: 'Failed to capture lead' }, { status: 500 });
  }
}
