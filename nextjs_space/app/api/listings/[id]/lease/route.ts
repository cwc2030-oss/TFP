/**
 * POST /api/listings/[id]/lease
 *
 * Lifecycle transition: PUBLISHED → LEASED. Owner-only.
 *
 * Mark a listing as taken so it disappears from public surfaces.
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
  if (listing.status !== 'PUBLISHED') {
    return NextResponse.json(
      { error: `Cannot mark leased from status ${listing.status}` },
      { status: 409 },
    );
  }

  const updated = await prisma.listing.update({
    where: { id: listing.id },
    data: { status: 'LEASED' },
  });
  return NextResponse.json({ listing: updated });
}
