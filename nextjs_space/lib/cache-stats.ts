/**
 * Cache Hit Instrumentation
 * -------------------------
 * Records every time a request was served from a persistent cache instead of
 * calling Regrid (or re-running terrain analysis). Stored in the CacheHit table,
 * kept SEPARATE from RegridUsage so the Regrid daily-total alert is never
 * polluted by cache hits.
 *
 * A cache hit on a Regrid-backed endpoint == one Regrid API call avoided, which
 * is how we estimate calls-saved and dollars-saved in the admin usage view.
 */

import { prisma } from '@/lib/db';

/**
 * Estimated marginal cost of a single Regrid API call, in USD.
 * This is an ESTIMATE used only for the admin "dollars saved" indicator.
 * Override via REGRID_COST_PER_CALL env var with your real overage rate.
 */
export const REGRID_COST_PER_CALL = parseFloat(
  process.env.REGRID_COST_PER_CALL || '0.07'
);

/**
 * Tags whose cache hits represent an avoided Regrid API call (used for
 * calls-saved / dollars-saved). Terrain-cache hits save compute, not Regrid
 * calls, so they are tracked but excluded from the Regrid savings math.
 */
export const REGRID_BACKED_CACHE_TAGS = new Set([
  'parcel',
  'neighbors',
  'adjacent',
]);

/**
 * Record a single cache hit for the given tag. Fire-and-forget: never throws,
 * never blocks the response.
 */
export async function recordCacheHit(cacheTag: string, count = 1): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  try {
    await prisma.cacheHit.upsert({
      where: { date_cacheTag: { date: today, cacheTag } },
      update: { hitCount: { increment: count } },
      create: { date: today, cacheTag, hitCount: count },
    });
  } catch (err) {
    // Non-fatal — instrumentation must never break a served request.
    console.error('[CACHE-HIT] record error:', err);
  }
}

/** Fire-and-forget wrapper so callers don't need to await. */
export function recordCacheHitAsync(cacheTag: string, count = 1): void {
  recordCacheHit(cacheTag, count).catch(() => {});
}

export async function getCacheHitStats(
  startDate: Date,
  endDate: Date
): Promise<{ date: string; cacheTag: string; hitCount: number }[]> {
  const rows = await prisma.cacheHit.findMany({
    where: { date: { gte: startDate, lte: endDate } },
    orderBy: [{ date: 'desc' }, { hitCount: 'desc' }],
    select: { date: true, cacheTag: true, hitCount: true },
  });

  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    cacheTag: r.cacheTag,
    hitCount: r.hitCount,
  }));
}
