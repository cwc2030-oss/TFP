/**
 * /api/listings
 *
 *  GET   — list current owner's listings, ordered by updatedAt desc
 *  POST  — create a DRAFT listing anchored to a SavedProperty.
 *           User must be signed in AND own the SavedProperty.
 *
 * Chunk 1: only DRAFT-level requirements enforced (savedPropertyId only).
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { createListingSchema } from '@/lib/listings';
import { ensureAutoListingImage } from '@/lib/parcel-listing-image';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const listings = await prisma.listing.findMany({
    where: { ownerUserId: session.user.id },
    orderBy: { updatedAt: 'desc' },
    include: {
      savedProperty: {
        select: {
          id: true,
          name: true,
          totalAcres: true,
          terrainScore: true,
          updatedAt: true,
        },
      },
    },
  });

  return NextResponse.json({ listings });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createListingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Owner-of-SavedProperty check. Hardstop: prevents user A from
  // anchoring a listing to user B's territory.
  const sp = await prisma.savedProperty.findFirst({
    where: { id: parsed.data.savedPropertyId, userId: session.user.id },
  });
  if (!sp) {
    return NextResponse.json(
      { error: 'SavedProperty not found or not owned by user' },
      { status: 404 },
    );
  }

  const listing = await prisma.listing.create({
    data: {
      ownerUserId: session.user.id,
      savedPropertyId: sp.id,
      // We deliberately do NOT snapshot any fields at DRAFT creation;
      // chunk 3 will run the snapshot helper at PUBLISH transition.
      // Drift tracker captured up-front so we can later compare.
      savedPropertyUpdatedAt: sp.updatedAt,
      status: 'DRAFT',
    },
  });

  // Auto-generate a parcel-shape listing image from the anchored territory
  // geometry and attach it as photo #1, so a landowner can reach the publish
  // step with ZERO uploaded photos. Best-effort / non-fatal: a failure here
  // never blocks listing creation (the owner can still upload their own).
  let photos = listing.photos;
  const generated = await ensureAutoListingImage(
    { id: listing.id, photos: listing.photos, county: listing.county, state: listing.state },
    sp,
  );
  if (generated) photos = generated;

  return NextResponse.json({ listing: { ...listing, photos } }, { status: 201 });
}
