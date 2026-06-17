import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";

export const dynamic = 'force-dynamic';

interface FunnelStep {
  step: string;
  event: string;
  count: number;
  dropoff: number;
  conversionFromPrev: number;
  prevCount: number;
  prevDropoff: number;
  prevConversionFromPrev: number;
  countDelta: number;       // absolute change
  countDeltaPct: number;    // percentage change
}

async function getEventCounts(since: Date, until?: Date) {
  const where: any = { createdAt: { gte: since } };
  if (until) where.createdAt.lt = until;

  const events = await prisma.funnelEvent.groupBy({
    by: ['event'],
    _count: { id: true },
    where,
  });

  const map: Record<string, number> = {};
  events.forEach((e: { event: string; _count: { id: number } }) => {
    map[e.event] = e._count.id;
  });
  return map;
}

async function getPurchaseBreakdown(since: Date, until?: Date) {
  const where: any = { event: 'purchase_completed', createdAt: { gte: since } };
  if (until) where.createdAt.lt = until;

  const purchases = await prisma.funnelEvent.findMany({
    where,
    select: { metadata: true },
  });

  const breakdown: Record<string, number> = {};
  purchases.forEach((p: { metadata: string | null }) => {
    try {
      const m = JSON.parse(p.metadata || '{}');
      const type = m.productType || 'unknown';
      breakdown[type] = (breakdown[type] || 0) + 1;
    } catch {
      breakdown['unknown'] = (breakdown['unknown'] || 0) + 1;
    }
  });
  return breakdown;
}

function buildFunnel(eventMap: Record<string, number>) {
  const steps = [
    { step: 'Address Searched', event: 'address_search' },
    { step: 'Terrain Analyzer Opened', event: 'terrain_analyzer_opened' },
    { step: 'Pricing Page Viewed', event: 'pricing_page_viewed' },
    { step: 'Checkout Initiated', event: 'checkout_initiated' },
    { step: 'Purchase Completed', event: 'purchase_completed' },
  ];

  return steps.map((s, i) => {
    const count = eventMap[s.event] || 0;
    const prev = i > 0 ? (eventMap[steps[i - 1].event] || 0) : count;
    const dropoff = prev > 0 ? Math.round(((prev - count) / prev) * 100) : 0;
    const conversionFromPrev = prev > 0 ? Math.round((count / prev) * 100) : 0;
    return { ...s, count, dropoff: i === 0 ? 0 : dropoff, conversionFromPrev: i === 0 ? 100 : conversionFromPrev };
  });
}

// GET: Return funnel stats for a given period (admin only or internal)
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const isAdmin = (session?.user as any)?.role === 'admin';
  const internalSecret = request.headers.get('x-internal-secret');
  const isInternal = internalSecret === process.env.NEXTAUTH_SECRET;

  if (!isAdmin && !isInternal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '7', 10);
  const includeWoW = searchParams.get('wow') === '1';

  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - days);

  try {
    // Current period
    const currentMap = await getEventCounts(since);
    const currentFunnel = buildFunnel(currentMap);
    const currentBreakdown = await getPurchaseBreakdown(since);

    // Overall conversion
    const topCount = currentMap['address_search'] || 0;
    const bottomCount = currentMap['purchase_completed'] || 0;
    const overallConversion = topCount > 0 ? ((bottomCount / topCount) * 100).toFixed(2) : '0.00';

    let result: any = {
      period: `Last ${days} days`,
      since: since.toISOString(),
      until: now.toISOString(),
      funnel: currentFunnel,
      purchaseBreakdown: currentBreakdown,
      overallConversion: parseFloat(overallConversion),
    };

    // Week-over-week comparison
    if (includeWoW) {
      const prevStart = new Date(since);
      prevStart.setDate(prevStart.getDate() - days);
      const prevEnd = since;

      const prevMap = await getEventCounts(prevStart, prevEnd);
      const prevFunnel = buildFunnel(prevMap);
      const prevBreakdown = await getPurchaseBreakdown(prevStart, prevEnd);

      const prevTopCount = prevMap['address_search'] || 0;
      const prevBottomCount = prevMap['purchase_completed'] || 0;
      const prevOverallConversion = prevTopCount > 0 ? ((prevBottomCount / prevTopCount) * 100).toFixed(2) : '0.00';

      // Merge WoW into funnel steps
      const funnelWithWoW: FunnelStep[] = currentFunnel.map((step, i) => {
        const prev = prevFunnel[i];
        const countDelta = step.count - prev.count;
        const countDeltaPct = prev.count > 0 ? Math.round(((step.count - prev.count) / prev.count) * 100) : (step.count > 0 ? 100 : 0);
        return {
          ...step,
          prevCount: prev.count,
          prevDropoff: prev.dropoff,
          prevConversionFromPrev: prev.conversionFromPrev,
          countDelta,
          countDeltaPct,
        };
      });

      result = {
        ...result,
        funnel: funnelWithWoW,
        previousPeriod: {
          since: prevStart.toISOString(),
          until: prevEnd.toISOString(),
          purchaseBreakdown: prevBreakdown,
          overallConversion: parseFloat(prevOverallConversion),
        },
      };
    }

    // Cross-check with Order table
    const completedOrders = await prisma.order.count({
      where: {
        createdAt: { gte: since },
        status: { in: ['paid', 'demo_checkout'] },
      },
    });
    result.ordersCrossCheck = { completed: completedOrders };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Funnel stats error:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
