/**
 * POST /api/listings/[id]/publish
 *
 * Lifecycle transition: DRAFT → PENDING_REVIEW.
 * If TFP_LISTINGS_AUTO_APPROVE === 'true' (default for MVP), automatically
 * promotes to PUBLISHED in the same call and stamps publishedAt.
 *
 * Validation:
 *  - 401 if unauthenticated
 *  - 403 if caller is not the owner
 *  - 404 if listing not found
 *  - 409 if status is not DRAFT (already past this transition)
 *  - 400 with field-level errors if any publish requirement fails
 *
 * On success: snapshotFromSavedProperty() refreshes acres / terrainScore /
 * primaryMovement / bedAcres / funnelCount / savedPropertyUpdatedAt from
 * the current SavedProperty so the listing reflects the latest analysis.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { snapshotFromSavedProperty, validateForPublish } from '@/lib/listings';
import { buildFlowSnapshot } from '@/lib/listing-flow-snapshot';

export const dynamic = 'force-dynamic';

function autoApproveEnabled(): boolean {
  // Default is true so the MVP doesn't block on a missing env var. Set
  // TFP_LISTINGS_AUTO_APPROVE=false to require manual moderation.
  const v = (process.env.TFP_LISTINGS_AUTO_APPROVE ?? 'true').toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const listing = await prisma.listing.findUnique({
    where: { id: params.id },
    include: { savedProperty: true },
  });
  if (!listing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (listing.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (listing.status !== 'DRAFT') {
    return NextResponse.json(
      { error: `Cannot publish from status ${listing.status}` },
      { status: 409 },
    );
  }

  // Refresh snapshot fields from the current SavedProperty before validating.
  // This is the ONE place state/county are NOT touched — they come from
  // the listing's owner-supplied values (set via the wizard PATCH).
  const snap = snapshotFromSavedProperty(listing.savedProperty);

  const candidate = {
    savedPropertyId: listing.savedPropertyId,
    state: listing.state,
    county: listing.county,
    acres: snap.acres,
    askingPriceMin: listing.askingPriceMin,
    askingPriceMax: listing.askingPriceMax,
    leaseType: listing.leaseType,
    huntersMax: listing.huntersMax,
    seasonAvailability: listing.seasonAvailability,
    description: listing.description,
    photos: listing.photos,
    contactMethod: listing.contactMethod,
    contactEmail: listing.contactEmail,
    contactPhone: listing.contactPhone,
  };
  const errors = validateForPublish(candidate);
  if (errors.length > 0) {
    return NextResponse.json({ error: 'Validation failed', errors }, { status: 400 });
  }

  // Build Deer-Flow snapshot for the owner/lessee tier.
  // Best-effort: if the terrain cache has expired, the listing still publishes
  // without flow data (field stays null).
  let terrainFlowSnapshot: string | null = null;
  let corridorCount: number | null = null;
  let interceptCount: number | null = null;
  try {
    terrainFlowSnapshot = await buildFlowSnapshot(listing.savedProperty);
    if (terrainFlowSnapshot) {
      const parsed = JSON.parse(terrainFlowSnapshot);
      corridorCount =
        (parsed.flowPrimary?.features?.length ?? 0) +
        (parsed.flowSecondary?.features?.length ?? 0);
      interceptCount = parsed.convergenceZones?.features?.length ?? 0;
    }
  } catch (e) {
    console.warn('[Publish] Flow snapshot failed (non-fatal):', e);
  }

  const auto = autoApproveEnabled();
  const now = new Date();
  const updated = await prisma.listing.update({
    where: { id: listing.id },
    data: {
      // Snapshot refresh
      acres: snap.acres,
      terrainScore: snap.terrainScore,
      primaryMovement: snap.primaryMovement,
      bedAcres: snap.bedAcres,
      funnelCount: snap.funnelCount,
      savedPropertyUpdatedAt: snap.savedPropertyUpdatedAt,
      terrainFlowSnapshot,
      corridorCount,
      interceptCount,
      // Status transition
      status: auto ? 'PUBLISHED' : 'PENDING_REVIEW',
      publishedAt: auto ? now : null,
    },
  });

  return NextResponse.json({ listing: updated, autoApproved: auto });
}
