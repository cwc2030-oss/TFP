/**
 * Brick 1 — owner browse-and-choose API.
 *
 * GATED behind TFP_HUNTER_PROFILES_OPEN. Auth-required AND restricted to
 * LANDOWNERS (a user who owns >=1 Listing, or admin) per requirement #2.
 *
 * Returns only BROWSE-ELIGIBLE profiles: visible == true AND
 * firearmAttestation == true (the affirmative-claim hard gate). An
 * un-attested hunter can never appear in the pool.
 *
 * OPSEC / PII: reference contacts are NEVER included in the browse payload.
 * We surface only referenceCount so the owner knows references exist; the
 * contact details stay hidden until genuine engagement (deferred).
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { areHunterProfilesOpen } from '@/lib/hunter-profiles-gate';
import { isLandowner } from '@/lib/landowner';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!areHunterProfilesOpen()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session?.user as any)?.role as string | undefined;
  if (!(await isLandowner(userId, role))) {
    return NextResponse.json(
      { error: 'Browsing the hunter pool is for landowners only.' },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const dayHuntOnly = url.searchParams.get('dayHuntOnly') === '1';
  const noATV = url.searchParams.get('noATV') === '1';
  const hasInsurance = url.searchParams.get('hasInsurance') === '1';
  const footprint = url.searchParams.get('footprint'); // exact enum or null
  const maxGroupSizeRaw = url.searchParams.get('maxGroupSize');
  const maxGroupSize = maxGroupSizeRaw ? parseInt(maxGroupSizeRaw, 10) : null;

  // Hard gate: only visible + attested profiles are ever eligible.
  const where: any = { visible: true, firearmAttestation: true };

  if (dayHuntOnly) where.footprint = 'DAY_HUNT';
  else if (footprint) where.footprint = footprint;
  if (noATV) where.hasATV = { not: true }; // excludes explicit true; keeps null/false
  if (hasInsurance) where.liabilityInsurance = { in: ['SELF_ATTESTED', 'DOCUMENT_ON_FILE'] };
  if (maxGroupSize && !Number.isNaN(maxGroupSize)) {
    where.OR = [{ groupSize: { lte: maxGroupSize } }, { groupSize: null }];
  }

  const [profiles, shortlisted] = await Promise.all([
    prisma.hunterProfile.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { user: { select: { name: true } } },
    }),
    prisma.hunterShortlist.findMany({
      where: { ownerUserId: userId },
      select: { hunterProfileId: true },
    }),
  ]);

  const shortlistedIds = new Set(shortlisted.map((s) => s.hunterProfileId));

  // Shape a PII-safe payload. No reference contacts. No email. Display name
  // only (falls back to "Hunter").
  const items = profiles.map((p) => {
    const refs = Array.isArray(p.references) ? (p.references as any[]) : [];
    return {
      id: p.id,
      displayName: p.user?.name?.trim() || 'Hunter',
      groupSize: p.groupSize,
      hasKidsFamily: p.hasKidsFamily,
      footprint: p.footprint,
      needsPowerHookup: p.needsPowerHookup,
      needsWaterHookup: p.needsWaterHookup,
      hasATV: p.hasATV,
      huntingLicense: p.huntingLicense,
      hunterEd: p.hunterEd,
      liabilityInsurance: p.liabilityInsurance,
      mdcPermits: p.mdcPermits,
      firearmAttestation: p.firearmAttestation,
      referenceCount: refs.length,
      completedLeaseCount: p.completedLeaseCount,
      bio: p.bio,
      shortlisted: shortlistedIds.has(p.id),
    };
  });

  return NextResponse.json({ items });
}
