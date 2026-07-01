export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { gradeMinScore } from '@/lib/listings';

/**
 * GET /api/county-flow
 *
 * Public, OPSEC-safe county-level Deer Flow ratings (finest grain = county).
 * Query params:
 *   state   — optional 2-letter filter (e.g. "MO")
 *   minGrade— optional letter grade floor (e.g. "B-")
 *   limit   — optional cap (default 200)
 *
 * Returns: { counties: [...], states: [...] }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const state = (searchParams.get('state') || '').toUpperCase().trim();
    const minGrade = (searchParams.get('minGrade') || '').trim();
    const limit = Math.min(Number(searchParams.get('limit')) || 200, 500);

    const where: any = {};
    if (/^[A-Z]{2}$/.test(state)) where.state = state;
    if (minGrade) {
      const floor = gradeMinScore(minGrade);
      if (floor > 0) where.avgFlowIndex = { gte: floor };
    }

    const counties = await prisma.countyFlowRating.findMany({
      where,
      orderBy: [{ avgFlowIndex: 'desc' }, { parcelCount: 'desc' }],
      take: limit,
      select: {
        state: true,
        county: true,
        parcelCount: true,
        avgFlowIndex: true,
        grade: true,
        avgFunnelCount: true,
        avgBedAcres: true,
        avgTopStand: true,
        highFlowCount: true,
        updatedAt: true,
      },
    });

    // Distinct state list for the filter UI.
    const stateRows = await prisma.countyFlowRating.findMany({
      distinct: ['state'],
      select: { state: true },
      orderBy: { state: 'asc' },
    });

    return NextResponse.json({
      counties,
      states: stateRows.map((s) => s.state),
    });
  } catch (e) {
    console.error('[county-flow] GET error:', e);
    return NextResponse.json({ error: 'Failed to load county flow ratings' }, { status: 500 });
  }
}
