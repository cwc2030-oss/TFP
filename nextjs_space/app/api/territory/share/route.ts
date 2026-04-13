import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { propertyId } = await req.json();
  if (!propertyId) {
    return NextResponse.json({ error: 'Missing propertyId' }, { status: 400 });
  }

  const property = await prisma.savedProperty.findFirst({
    where: { id: propertyId, userId: session.user.id }
  });

  if (!property) {
    return NextResponse.json({ error: 'Property not found' }, { status: 404 });
  }

  // Toggle sharing on
  const updated = await prisma.savedProperty.update({
    where: { id: propertyId },
    data: { isShared: true }
  });

  return NextResponse.json({
    success: true,
    shareId: updated.shareId,
    shareUrl: `/territory/${updated.shareId}`
  });
}
