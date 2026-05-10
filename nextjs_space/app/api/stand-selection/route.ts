export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

// POST — lock a stand selection for today
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  try {
    const body = await req.json();
    const { parcelId, standLng, standLat, standName, terrainFeature, confidence, windDirection, groundMoisture, seasonPhase } = body;

    if (!parcelId || !standName || !terrainFeature || confidence == null || !windDirection || !groundMoisture || !seasonPhase) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Today's date in UTC (date only)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Upsert — one selection per user per day
    const selection = await prisma.standSelection.upsert({
      where: {
        userId_huntDate: {
          userId: user.id,
          huntDate: today,
        },
      },
      update: {
        parcelId: String(parcelId),
        standLng: Number(standLng),
        standLat: Number(standLat),
        standName: String(standName),
        terrainFeature: String(terrainFeature),
        confidence: Number(confidence),
        windDirection: String(windDirection),
        groundMoisture: String(groundMoisture),
        seasonPhase: String(seasonPhase),
      },
      create: {
        userId: user.id,
        parcelId: String(parcelId),
        standLng: Number(standLng),
        standLat: Number(standLat),
        standName: String(standName),
        terrainFeature: String(terrainFeature),
        confidence: Number(confidence),
        windDirection: String(windDirection),
        groundMoisture: String(groundMoisture),
        seasonPhase: String(seasonPhase),
        huntDate: today,
      },
    });

    return NextResponse.json({ ok: true, selection });
  } catch (err) {
    console.error('[StandSelection] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET — fetch today's selection for current user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ selection: null });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) {
    return NextResponse.json({ selection: null });
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const selection = await prisma.standSelection.findUnique({
    where: {
      userId_huntDate: {
        userId: user.id,
        huntDate: today,
      },
    },
  });

  return NextResponse.json({ selection });
}
