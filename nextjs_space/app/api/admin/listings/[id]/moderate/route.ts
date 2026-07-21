/**
 * POST /api/admin/listings/[id]/moderate
 *
 * Admin-only moderation action on a single listing.
 * Body: { action: 'approve' | 'reject' }
 *   approve : PENDING_REVIEW -> PUBLISHED (stamps publishedAt if unset)
 *   reject  : PENDING_REVIEW | PUBLISHED -> WITHDRAWN (pulls it off the
 *             public marketplace; data is kept, owner can re-submit)
 *
 * This is the human review gate that stops any listing reaching the live
 * marketplace unreviewed (paired with TFP_LISTINGS_AUTO_APPROVE=false).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const action = body.action;
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const listing = await prisma.listing.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, publishedAt: true },
  });
  if (!listing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (action === 'approve') {
    if (listing.status !== 'PENDING_REVIEW') {
      return NextResponse.json(
        { error: `Cannot approve from status ${listing.status}` },
        { status: 409 },
      );
    }
    const updated = await prisma.listing.update({
      where: { id: listing.id },
      data: { status: 'PUBLISHED', publishedAt: listing.publishedAt ?? new Date() },
      select: { id: true, status: true, publishedAt: true },
    });
    return NextResponse.json({ listing: updated });
  }

  // reject
  if (listing.status !== 'PENDING_REVIEW' && listing.status !== 'PUBLISHED') {
    return NextResponse.json(
      { error: `Cannot reject from status ${listing.status}` },
      { status: 409 },
    );
  }
  const updated = await prisma.listing.update({
    where: { id: listing.id },
    data: { status: 'WITHDRAWN' },
    select: { id: true, status: true, publishedAt: true },
  });
  return NextResponse.json({ listing: updated });
}
