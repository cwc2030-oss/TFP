import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = 'force-dynamic';

// POST: Log a funnel event (called from client-side alongside GA)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { event, address, metadata } = body;

    if (!event) {
      return NextResponse.json({ error: "event is required" }, { status: 400 });
    }

    const validEvents = [
      'address_search',
      'terrain_analyzer_opened',
      'pricing_page_viewed',
      'checkout_initiated',
      'purchase_completed',
      'territory_teaser_shown',
      'territory_teaser_clicked',
    ];

    if (!validEvents.includes(event)) {
      return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
    }

    await prisma.funnelEvent.create({
      data: {
        event,
        address: address || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Funnel event error:", error);
    return NextResponse.json({ ok: true }); // Don't break UX on tracking failure
  }
}
