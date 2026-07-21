export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import {
  READS_PER_SEASON,
  ANON_FREE_READS,
  ANON_READS_COOKIE,
  parseAnonReads,
  getCurrentSeason,
  isReadsUnlocked,
} from '@/lib/reads';

/**
 * GET /api/reads/status
 * Returns the current user's Terrain Brain read state for this season.
 * Anonymous callers get { authenticated: false }.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      // Anonymous: report the best-effort first-look allowance so the meter
      // chip can show "1 free look" progress before signup.
      const anonUsed = parseAnonReads(req.cookies.get(ANON_READS_COOKIE)?.value).length;
      return NextResponse.json({
        authenticated: false,
        unlocked: false,
        used: anonUsed,
        limit: READS_PER_SEASON,
        remaining: Math.max(0, ANON_FREE_READS - anonUsed),
        anonFree: ANON_FREE_READS,
        season: getCurrentSeason(),
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { readsUnlocked: true, subscriptionStatus: true, role: true, seasonPassSeason: true, seasonPassExpiry: true },
    });

    const unlocked = isReadsUnlocked(user);
    const season = getCurrentSeason();
    const used = unlocked
      ? 0
      : await prisma.parcelRead.count({ where: { userId, season } });
    const remaining = unlocked ? Infinity : Math.max(0, READS_PER_SEASON - used);

    return NextResponse.json({
      authenticated: true,
      unlocked,
      used,
      limit: READS_PER_SEASON,
      remaining: unlocked ? null : remaining,
      season,
    });
  } catch (err) {
    console.error('[reads/status] error:', err);
    // Fail-open so a transient DB hiccup never blocks the free hero flow.
    return NextResponse.json({
      authenticated: false,
      unlocked: false,
      used: 0,
      limit: READS_PER_SEASON,
      remaining: READS_PER_SEASON,
      season: getCurrentSeason(),
      error: true,
    });
  }
}
