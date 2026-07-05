export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { gradeMinScore } from '@/lib/listings';
import { LAUNCH_STATES } from '@/lib/county-flow';

/**
 * GET /api/county-flow
 *
 * Public, OPSEC-safe county-level Deer Flow ratings (finest grain = county).
 * Query params:
 *   state   — optional 2-letter filter (e.g. "MO")
 *   minGrade— optional letter grade floor (e.g. "B-")
 *   sort    — "flow" (default, adjusted Deer Flow Index) | "highflow" (# high-flow parcels)
 *   limit   — optional cap (default 200)
 *
 * Returns: { counties: [...], states: [...] }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const state = (searchParams.get('state') || '').toUpperCase().trim();
    const minGrade = (searchParams.get('minGrade') || '').trim();
    const sort = (searchParams.get('sort') || 'flow').toLowerCase().trim();
    const limit = Math.min(Number(searchParams.get('limit')) || 200, 500);

    // Public API is scoped to launch states only. A specific state filter
    // must itself be a launch state; otherwise we constrain to the full set
    // so stray non-launch-state parcels (e.g. WY) never leak out.
    const where: any = {};
    if (/^[A-Z]{2}$/.test(state) && (LAUNCH_STATES as readonly string[]).includes(state)) {
      where.state = state;
    } else {
      where.state = { in: [...LAUNCH_STATES] };
    }
    if (minGrade) {
      // Grade floor applies to the trustworthy adjusted score (matches ranking).
      const floor = gradeMinScore(minGrade);
      if (floor > 0) where.adjustedFlowIndex = { gte: floor };
    }

    const orderBy =
      sort === 'highflow'
        ? [{ highFlowCount: 'desc' as const }, { adjustedFlowIndex: 'desc' as const }]
        : [{ adjustedFlowIndex: 'desc' as const }, { parcelCount: 'desc' as const }];

    const counties = await prisma.countyFlowRating.findMany({
      where,
      orderBy,
      take: limit,
      select: {
        state: true,
        county: true,
        parcelCount: true,
        avgFlowIndex: true,
        adjustedFlowIndex: true,
        limitedData: true,
        grade: true,
        avgFunnelCount: true,
        avgBedAcres: true,
        avgTopStand: true,
        highFlowCount: true,
        updatedAt: true,
      },
    });

    // Filter UI always offers the full launch-state set, in launch order —
    // including states with zero rated counties yet (e.g. Iowa).
    return NextResponse.json({
      counties,
      states: [...LAUNCH_STATES],
    });
  } catch (e) {
    console.error('[county-flow] GET error:', e);
    return NextResponse.json({ error: 'Failed to load county flow ratings' }, { status: 500 });
  }
}
