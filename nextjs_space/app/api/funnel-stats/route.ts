import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";

export const dynamic = 'force-dynamic';

// GET: Return funnel stats for a given period (admin only)
export async function GET(request: NextRequest) {
  // Check admin auth
  const session = await getServerSession(authOptions);
  const isAdmin = (session?.user as any)?.role === 'admin';

  // Also allow internal calls with a secret header
  const internalSecret = request.headers.get('x-internal-secret');
  const isInternal = internalSecret === process.env.NEXTAUTH_SECRET;

  if (!isAdmin && !isInternal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '7', 10);

  const since = new Date();
  since.setDate(since.getDate() - days);

  try {
    // Get event counts
    const events = await prisma.funnelEvent.groupBy({
      by: ['event'],
      _count: { id: true },
      where: { createdAt: { gte: since } },
    });

    // Also get completed orders from the Order table as a cross-check
    const completedOrders = await prisma.order.count({
      where: {
        createdAt: { gte: since },
        status: { in: ['paid', 'demo_checkout'] },
      },
    });

    const totalOrders = await prisma.order.count({
      where: { createdAt: { gte: since } },
    });

    // Build funnel
    const eventMap: Record<string, number> = {};
    events.forEach((e: { event: string; _count: { id: number } }) => { eventMap[e.event] = e._count.id; });

    const funnel = [
      { step: 'Address Searched', event: 'address_search', count: eventMap['address_search'] || 0 },
      { step: 'Terrain Analyzer Opened', event: 'terrain_analyzer_opened', count: eventMap['terrain_analyzer_opened'] || 0 },
      { step: 'Pricing Page Viewed', event: 'pricing_page_viewed', count: eventMap['pricing_page_viewed'] || 0 },
      { step: 'Checkout Initiated', event: 'checkout_initiated', count: eventMap['checkout_initiated'] || 0 },
      { step: 'Purchase Completed', event: 'purchase_completed', count: eventMap['purchase_completed'] || 0 },
    ];

    // Calculate drop-off
    const funnelWithDropoff = funnel.map((step, i) => {
      const prev = i > 0 ? funnel[i - 1].count : step.count;
      const dropoff = prev > 0 ? Math.round(((prev - step.count) / prev) * 100) : 0;
      const conversionFromPrev = prev > 0 ? Math.round((step.count / prev) * 100) : 0;
      return { ...step, dropoff: i === 0 ? 0 : dropoff, conversionFromPrev: i === 0 ? 100 : conversionFromPrev };
    });

    return NextResponse.json({
      period: `Last ${days} days`,
      since: since.toISOString(),
      funnel: funnelWithDropoff,
      ordersSummary: {
        total: totalOrders,
        completed: completedOrders,
      },
    });
  } catch (error) {
    console.error("Funnel stats error:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
