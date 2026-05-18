import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getRegridUsageStats } from "@/lib/regrid-client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Admin-only: check session
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const days = Math.min(parseInt(searchParams.get('days') || '30', 10), 90);

  const endDate = new Date();
  endDate.setUTCHours(23, 59, 59, 999);
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - days);
  startDate.setUTCHours(0, 0, 0, 0);

  try {
    const rows = await getRegridUsageStats(startDate, endDate);

    // Aggregate by date for daily totals
    const dailyTotals: Record<string, { total: number; breakdown: Record<string, number> }> = {};
    for (const row of rows) {
      if (!dailyTotals[row.date]) {
        dailyTotals[row.date] = { total: 0, breakdown: {} };
      }
      dailyTotals[row.date].total += row.callCount;
      dailyTotals[row.date].breakdown[row.endpointTag] = row.callCount;
    }

    // Grand total
    const grandTotal = rows.reduce((sum, r) => sum + r.callCount, 0);

    // Tag totals
    const tagTotals: Record<string, number> = {};
    for (const row of rows) {
      tagTotals[row.endpointTag] = (tagTotals[row.endpointTag] || 0) + row.callCount;
    }

    return NextResponse.json({
      period: { startDate: startDate.toISOString().slice(0, 10), endDate: endDate.toISOString().slice(0, 10), days },
      grandTotal,
      tagTotals: Object.entries(tagTotals)
        .sort(([, a], [, b]) => b - a)
        .map(([tag, count]) => ({ tag, count })),
      dailyTotals: Object.entries(dailyTotals)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, data]) => ({ date, ...data })),
    });
  } catch (error) {
    console.error('[REGRID-USAGE] Admin endpoint error:', error);
    return NextResponse.json({ error: 'Failed to fetch usage stats' }, { status: 500 });
  }
}
