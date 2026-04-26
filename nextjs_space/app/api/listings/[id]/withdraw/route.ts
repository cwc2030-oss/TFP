/**
 * POST /api/listings/[id]/withdraw
 *
 * Lifecycle transition: DRAFT | PENDING_REVIEW | PUBLISHED → WITHDRAWN.
 * Owner-only.
 *
 * 401 unauth, 403 not-owner, 404 not-found,
 * 409 if status not in the allowed-from set.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export const dynamic = 'force-dynamic';

const ALLOWED_FROM = new Set(['DRAFT', 'PENDING_REVIEW', 'PUBLISHED']);

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
  if (!ALLOWED_FROM.has(listing.status)) {
    return NextResponse.json(
      { error: `Cannot withdraw from status ${listing.status}` },
      { status: 409 },
    );
  }

  const updated = await prisma.listing.update({
    where: { id: listing.id },
    data: { status: 'WITHDRAWN' },
  });
  return NextResponse.json({ listing: updated });
}
