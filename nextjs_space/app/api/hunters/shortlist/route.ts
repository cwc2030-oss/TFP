/**
 * Brick 1 — owner shortlist add/remove.
 *
 * GATED behind TFP_HUNTER_PROFILES_OPEN. Landowner-only. A landowner
 * shortlists a hunter in general (listingId omitted) for Brick 1.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { areHunterProfilesOpen } from '@/lib/hunter-profiles-gate';
import { isLandowner } from '@/lib/landowner';

export const dynamic = 'force-dynamic';

async function requireLandowner() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return { error: 'Unauthorized', status: 401 as const };
  const role = (session?.user as any)?.role as string | undefined;
  if (!(await isLandowner(userId, role))) {
    return { error: 'Landowners only.', status: 403 as const };
  }
  return { userId };
}

export async function POST(req: Request) {
  if (!areHunterProfilesOpen()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  const auth = await requireLandowner();
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const hunterProfileId = typeof body?.hunterProfileId === 'string' ? body.hunterProfileId : null;
  if (!hunterProfileId) {
    return NextResponse.json({ error: 'hunterProfileId required' }, { status: 400 });
  }

  const target = await prisma.hunterProfile.findUnique({ where: { id: hunterProfileId } });
  if (!target) {
    return NextResponse.json({ error: 'Hunter not found' }, { status: 404 });
  }

  // NOTE: we can't upsert on the compound unique here because listingId is
  // null for a general shortlist, and Prisma rejects null in a compound-unique
  // `where` (and Postgres treats NULLs as distinct, so the DB constraint would
  // not dedupe them either). Guard with a find-then-create instead — idempotent.
  const existing = await prisma.hunterShortlist.findFirst({
    where: { ownerUserId: auth.userId, hunterProfileId, listingId: null },
    select: { id: true },
  });
  if (!existing) {
    await prisma.hunterShortlist.create({
      data: { ownerUserId: auth.userId, hunterProfileId, listingId: null },
    });
  }

  return NextResponse.json({ ok: true, shortlisted: true });
}

export async function DELETE(req: Request) {
  if (!areHunterProfilesOpen()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  const auth = await requireLandowner();
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  const hunterProfileId = url.searchParams.get('hunterProfileId');
  if (!hunterProfileId) {
    return NextResponse.json({ error: 'hunterProfileId required' }, { status: 400 });
  }

  await prisma.hunterShortlist.deleteMany({
    where: { ownerUserId: auth.userId, hunterProfileId, listingId: null },
  });

  return NextResponse.json({ ok: true, shortlisted: false });
}
