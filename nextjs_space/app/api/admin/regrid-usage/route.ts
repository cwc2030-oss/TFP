import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getRegridUsageStats } from "@/lib/regrid-client";
import { getCacheHitStats, REGRID_COST_PER_CALL, REGRID_BACKED_CACHE_TAGS } from "@/lib/cache-stats";

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
    const [rows, hitRows] = await Promise.all([
      getRegridUsageStats(startDate, endDate),
      getCacheHitStats(startDate, endDate),
    ]);

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

    // ── Cache hit aggregation ──
    const cacheTagTotals: Record<string, number> = {};
    const cacheDaily: Record<string, number> = {};
    for (const h of hitRows) {
      cacheTagTotals[h.cacheTag] = (cacheTagTotals[h.cacheTag] || 0) + h.hitCount;
      cacheDaily[h.date] = (cacheDaily[h.date] || 0) + h.hitCount;
    }

    // Cache hits that each represent one AVOIDED Regrid API call.
    const regridCallsSaved = Object.entries(cacheTagTotals)
      .filter(([tag]) => REGRID_BACKED_CACHE_TAGS.has(tag))
      .reduce((sum, [, n]) => sum + n, 0);
    const totalCacheHits = Object.values(cacheTagTotals).reduce((s, n) => s + n, 0);

    // Hit rate across Regrid-backed lookups: served-from-cache / total lookups.
    const totalLookups = regridCallsSaved + grandTotal;
    const hitRate = totalLookups > 0 ? regridCallsSaved / totalLookups : 0;
    const estimatedDollarsSaved = regridCallsSaved * REGRID_COST_PER_CALL;

    return NextResponse.json({
      period: { startDate: startDate.toISOString().slice(0, 10), endDate: endDate.toISOString().slice(0, 10), days },
      grandTotal,
      tagTotals: Object.entries(tagTotals)
        .sort(([, a], [, b]) => b - a)
        .map(([tag, count]) => ({ tag, count })),
      dailyTotals: Object.entries(dailyTotals)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, data]) => ({ date, ...data })),
      cache: {
        regridCallsMade: grandTotal,
        regridCallsSaved,
        totalCacheHits,
        totalLookups,
        hitRate: Math.round(hitRate * 1000) / 10, // percent, 1 decimal
        costPerCall: REGRID_COST_PER_CALL,
        estimatedDollarsSaved: Math.round(estimatedDollarsSaved * 100) / 100,
        hitsByTag: Object.entries(cacheTagTotals)
          .sort(([, a], [, b]) => b - a)
          .map(([tag, count]) => ({ tag, count })),
        hitsByDate: Object.entries(cacheDaily)
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([date, count]) => ({ date, count })),
      },
    });
  } catch (error) {
    console.error('[REGRID-USAGE] Admin endpoint error:', error);
    return NextResponse.json({ error: 'Failed to fetch usage stats' }, { status: 500 });
  }
}
