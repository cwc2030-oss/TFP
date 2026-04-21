import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const {
    name, type, parcels, totalAcres,
    centroidLat, centroidLng,
    terrainScore, primaryMovement,
    funnelCount, standCount, bedAcres
  } = body;

  const saved = await prisma.savedProperty.create({
    data: {
      userId: session.user.id,
      name, type, parcels, totalAcres,
      centroidLat, centroidLng,
      terrainScore, primaryMovement,
      funnelCount, standCount, bedAcres
    }
  });

  return NextResponse.json({ success: true, property: saved });
}
