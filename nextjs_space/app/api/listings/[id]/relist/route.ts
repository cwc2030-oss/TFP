/**
 * POST /api/listings/[id]/relist
 *
 * Lifecycle transition: LEASED → PUBLISHED. Owner-only.
 * Used when the previous lease ended and the owner wants the listing
 * to reappear on the public marketplace.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const listing = await prisma.listing.findUnique({ where: { id: params.id } });
  if (!listing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (listing.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (listing.status !== 'LEASED') {
    return NextResponse.json(
      { error: `Cannot relist from status ${listing.status}` },
      { status: 409 },
    );
  }

  const updated = await prisma.listing.update({
    where: { id: listing.id },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
  });
  return NextResponse.json({ listing: updated });
}
