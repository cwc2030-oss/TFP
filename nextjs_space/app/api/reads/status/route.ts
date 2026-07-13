export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { READS_PER_SEASON, getCurrentSeason, isReadsUnlocked } from '@/lib/reads';

/**
 * GET /api/reads/status
 * Returns the current user's Terrain Brain read state for this season.
 * Anonymous callers get { authenticated: false }.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
      return NextResponse.json({
        authenticated: false,
        unlocked: false,
        used: 0,
        limit: READS_PER_SEASON,
        remaining: READS_PER_SEASON,
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
