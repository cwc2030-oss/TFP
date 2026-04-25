export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * GET /api/parcels/check-access?lat=XX&lng=YY
 * Returns whether the current user has full access to this parcel.
 * Full access = Pro/ProMax subscriber OR has a ParcelPurchase for this lat/lng.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat') || '');
  const lng = parseFloat(searchParams.get('lng') || '');

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: 'Missing lat/lng' }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ hasAccess: false, isPro: false, isLoggedIn: false });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { subscriptionStatus: true, role: true },
  });

  const subStatus = user?.subscriptionStatus || 'free';
  const role = user?.role || 'user';
  // Admin accounts are treated as Pro Max automatically, regardless of subscriptionStatus.
  const isPro = subStatus === 'pro' || subStatus === 'promax' || role === 'admin';

  // Pro/ProMax subscribers (and admins) always have full access
  if (isPro) {
    return NextResponse.json({ hasAccess: true, isPro: true, isLoggedIn: true });
  }

  // Check for a one-time purchase of this parcel
  // Use a small tolerance for floating point comparison (roughly 11m)
  const TOLERANCE = 0.0001;
  const purchase = await prisma.parcelPurchase.findFirst({
    where: {
      userId: session.user.id,
      parcelLat: { gte: lat - TOLERANCE, lte: lat + TOLERANCE },
      parcelLng: { gte: lng - TOLERANCE, lte: lng + TOLERANCE },
    },
  });

  return NextResponse.json({
    hasAccess: !!purchase,
    isPro: false,
    isLoggedIn: true,
    purchaseId: purchase?.id || null,
  });
}
