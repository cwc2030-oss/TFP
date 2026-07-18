import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { shareId: string } }
) {
  const { shareId } = params;

  const property = await prisma.savedProperty.findUnique({
    where: { shareId },
    include: { user: { select: { name: true, company: true } } }
  });

  if (!property || !property.isShared) {
    return NextResponse.json({ error: 'Territory not found or not shared' }, { status: 404 });
  }

  return NextResponse.json({
    name: property.name,
    type: property.type,
    parcels: property.parcels,
    totalAcres: property.totalAcres,
    centroidLat: property.centroidLat,
    centroidLng: property.centroidLng,
    terrainScore: property.terrainScore,
    primaryMovement: property.primaryMovement,
    funnelCount: property.funnelCount,
    standCount: property.standCount,
    bedAcres: property.bedAcres,
    backboneState: property.backboneState,
    backboneRank: property.backboneRank,
    ridgeSpineCount: property.ridgeSpineCount,
    saddleCrossings: property.saddleCrossings,
    convergenceZoneCount: property.convergenceZoneCount,
    sharedBy: property.user.name || property.user.company || 'Terra Firma User',
    createdAt: property.createdAt
  });
}
