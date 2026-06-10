/**
 * GET /api/listings/[id]/flow
 *
 * Auth-gated endpoint: returns the Deer-Flow snapshot for a PUBLISHED listing.
 * Requires a signed-in user session.  Anonymous requests get 401.
 *
 * OPSEC: This is the ONLY path through which parcel-level flow data
 * reaches the browser for a listing.  The public server-rendered page
 * never includes this data.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: 'Sign in to view the Deer Flow map' },
      { status: 401 },
    );
  }

  const listing = await prisma.listing.findFirst({
    where: { id: params.id, status: 'PUBLISHED' },
    select: {
      id: true,
      terrainFlowSnapshot: true,
      terrainScore: true,
      acres: true,
    },
  });

  if (!listing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!listing.terrainFlowSnapshot) {
    return NextResponse.json(
      { error: 'Flow data not available for this listing' },
      { status: 404 },
    );
  }

  try {
    const flow = JSON.parse(listing.terrainFlowSnapshot);
    return NextResponse.json({
      flow,
      terrainScore: listing.terrainScore,
      acres: listing.acres,
    });
  } catch {
    return NextResponse.json(
      { error: 'Flow data corrupted' },
      { status: 500 },
    );
  }
}
