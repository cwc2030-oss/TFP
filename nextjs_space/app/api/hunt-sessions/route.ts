export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

const VALID_OUTCOMES = ['saw_deer', 'harvested', 'scouted', 'no_activity'] as const;

/* POST — create a new hunt session ("Hunt This" tap) */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const body = await req.json();
    const {
      parcelId,
      standLabel,
      standCoordinates,
      standType,
      terrainFeatures,
      windDirection,
      rutPhase,
      groundMoisture,
      moonPhase,
    } = body;

    if (!parcelId || !standLabel || !standCoordinates || !windDirection || !rutPhase || !groundMoisture) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const huntSession = await prisma.huntSession.create({
      data: {
        userId: user.id,
        parcelId,
        standLabel,
        standCoordinates,
        standType: standType || 'Unknown',
        terrainFeatures: terrainFeatures || {},
        windDirection,
        rutPhase,
        groundMoisture,
        moonPhase: moonPhase || null,
        huntStartTime: new Date(),
      },
    });

    console.log(`[HuntSession] Created session ${huntSession.id} for user ${user.id}, stand "${standLabel}"`);
    return NextResponse.json({ id: huntSession.id, standLabel: huntSession.standLabel });
  } catch (err) {
    console.error('[HuntSession] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/* PATCH — record outcome for an existing hunt session */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const body = await req.json();
    const { huntSessionId, outcome, deerCount } = body;

    if (!huntSessionId || !outcome) {
      return NextResponse.json({ error: 'Missing huntSessionId or outcome' }, { status: 400 });
    }

    if (!VALID_OUTCOMES.includes(outcome)) {
      return NextResponse.json({ error: 'Invalid outcome' }, { status: 400 });
    }

    // Verify ownership
    const existing = await prisma.huntSession.findFirst({
      where: { id: huntSessionId, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Hunt session not found' }, { status: 404 });
    }
    if (existing.outcome) {
      return NextResponse.json({ error: 'Outcome already recorded' }, { status: 409 });
    }

    const updated = await prisma.huntSession.update({
      where: { id: huntSessionId },
      data: {
        outcome,
        outcomeRecordedAt: new Date(),
        deerCount: typeof deerCount === 'number' ? deerCount : null,
      },
    });

    console.log(`[HuntSession] Outcome recorded: ${outcome} for session ${huntSessionId}`);
    return NextResponse.json({ id: updated.id, outcome: updated.outcome });
  } catch (err) {
    console.error('[HuntSession] PATCH error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/* GET — fetch a single hunt session by id (for outcome card reload) */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id param' }, { status: 400 });

    const huntSession = await prisma.huntSession.findFirst({
      where: { id, userId: user.id },
    });
    if (!huntSession) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(huntSession);
  } catch (err) {
    console.error('[HuntSession] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
