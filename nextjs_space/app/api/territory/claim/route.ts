import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { shareId } = await req.json();
  if (!shareId) {
    return NextResponse.json({ error: 'Missing shareId' }, { status: 400 });
  }

  const source = await prisma.savedProperty.findUnique({
    where: { shareId }
  });

  if (!source || !source.isShared) {
    return NextResponse.json({ error: 'Territory not found or not shared' }, { status: 404 });
  }

  // Don't duplicate if user already owns this exact territory
  if (source.userId === session.user.id) {
    return NextResponse.json({ success: true, alreadyOwned: true, propertyId: source.id });
  }

  // Check if already claimed (same user, same name + centroid)
  const existing = await prisma.savedProperty.findFirst({
    where: {
      userId: session.user.id,
      name: source.name,
      centroidLat: source.centroidLat,
      centroidLng: source.centroidLng
    }
  });

  if (existing) {
    return NextResponse.json({ success: true, alreadyOwned: true, propertyId: existing.id });
  }

  // Clone the territory to the claiming user's account
  const claimed = await prisma.savedProperty.create({
    data: {
      userId: session.user.id,
      name: source.name,
      type: source.type,
      parcels: source.parcels as any,
      totalAcres: source.totalAcres,
      centroidLat: source.centroidLat,
      centroidLng: source.centroidLng,
      terrainScore: source.terrainScore,
      primaryMovement: source.primaryMovement,
      funnelCount: source.funnelCount,
      standCount: source.standCount,
      bedAcres: source.bedAcres,
      backboneState: source.backboneState,
      backboneRank: source.backboneRank,
      ridgeSpineCount: source.ridgeSpineCount,
      saddleCrossings: source.saddleCrossings,
      convergenceZoneCount: source.convergenceZoneCount,
      backboneComputedAt: source.backboneComputedAt,
      notes: `Claimed from shared territory by ${source.userId}`
    }
  });

  return NextResponse.json({ success: true, propertyId: claimed.id });
}
