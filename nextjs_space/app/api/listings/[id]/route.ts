/**
 * /api/listings/[id]
 *
 *  GET   — fetch a single listing the caller owns. Used by /listings/[id]/edit.
 *  PATCH — update DRAFT fields. Validates with updateListingSchema.
 *           Refuses to mutate listings the caller does not own.
 *
 * OPSEC: this route does not accept any precise-location fields. Anything
 * outside the updateListingSchema allowlist is rejected by `.strict()`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { updateListingSchema } from '@/lib/listings';

export const dynamic = 'force-dynamic';

async function loadOwned(id: string, userId: string) {
  return prisma.listing.findFirst({
    where: { id, ownerUserId: userId },
    include: {
      savedProperty: {
        select: {
          id: true,
          name: true,
          totalAcres: true,
          terrainScore: true,
          primaryMovement: true,
          bedAcres: true,
          funnelCount: true,
          updatedAt: true,
        },
      },
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const listing = await loadOwned(params.id, session.user.id);
  if (!listing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ listing });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const existing = await loadOwned(params.id, session.user.id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Refuse to PATCH anything past DRAFT. Lifecycle transitions out of
  // DRAFT are reserved for chunks 3+ (publish flow, admin review).
  if (existing.status !== 'DRAFT') {
    return NextResponse.json(
      { error: `Cannot edit listing in status ${existing.status}` },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = updateListingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Prisma JSON fields require Prisma.JsonNull (not plain null) for explicit clears.
  // Translate amenities: null → Prisma.JsonNull, leave undefined / object alone.
  const { amenities, ...rest } = parsed.data;
  const data: Prisma.ListingUpdateInput = {
    ...rest,
    ...(amenities === undefined
      ? {}
      : { amenities: amenities === null ? Prisma.JsonNull : amenities }),
  };

  const updated = await prisma.listing.update({
    where: { id: existing.id },
    data,
  });

  return NextResponse.json({ listing: updated });
}
