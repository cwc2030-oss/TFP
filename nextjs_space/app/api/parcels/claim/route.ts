export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { matchOwnerName } from '@/lib/claims';

/**
 * Landowner path — "Claim this parcel as mine."
 *
 * POST   /api/parcels/claim   { parcelKey, regridOwner?, address?, lat?, lng?, acreage? }
 *   Soft-verifies by matching the signed-in user's name against the Regrid
 *   owner-of-record. On a confident personal-name match -> MATCHED (own ground:
 *   reads free + flagged listable). Otherwise -> PENDING (never silently
 *   granted). Idempotent upsert on (userId, parcelKey).
 *
 * GET    /api/parcels/claim   -> { claims: [...] } for the signed-in user.
 * DELETE /api/parcels/claim?parcelKey=...  -> removes the claim (unclaim).
 *
 * Honesty: a MATCHED claim is SOFT-verified only. It is NOT "Verified Owner"
 * and does NOT authorize listing/money — hard verification (reusing this record,
 * tightened) is required downstream before any listing goes live.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) {
      return NextResponse.json({ error: 'Sign in to claim a parcel.' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const parcelKey: string = (body?.parcelKey || '').toString().trim();
    if (!parcelKey) {
      return NextResponse.json({ error: 'Missing parcel reference.' }, { status: 400 });
    }
    const regridOwner: string = (body?.regridOwner || '').toString().trim().slice(0, 300);
    const address: string | undefined = body?.address ? String(body.address).slice(0, 300) : undefined;
    const lat = typeof body?.lat === 'number' ? body.lat : undefined;
    const lng = typeof body?.lng === 'number' ? body.lng : undefined;
    const acreage = typeof body?.acreage === 'number' ? body.acreage : undefined;

    // Claimant name from the account (fall back to the DB record if the session
    // is thin). Without a name we can only go PENDING.
    let claimantName = (session?.user as any)?.name as string | undefined;
    if (!claimantName) {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      claimantName = u?.name || undefined;
    }

    const ownerMatchStatus = matchOwnerName(claimantName, regridOwner);
    const listable = ownerMatchStatus === 'MATCHED';

    const claim = await prisma.parcelClaim.upsert({
      where: { userId_parcelKey: { userId, parcelKey } },
      create: {
        userId, parcelKey, ownerMatchStatus, listable,
        regridOwnerName: regridOwner || null,
        claimantName: claimantName || null,
        address: address || null, lat: lat ?? null, lng: lng ?? null, acreage: acreage ?? null,
      },
      update: {
        // Re-evaluate the soft match on re-claim (owner data may have refreshed).
        ownerMatchStatus, listable,
        regridOwnerName: regridOwner || null,
        claimantName: claimantName || null,
        address: address || undefined, lat: lat ?? undefined, lng: lng ?? undefined, acreage: acreage ?? undefined,
      },
      select: {
        id: true, parcelKey: true, ownerMatchStatus: true, listable: true,
        regridOwnerName: true, address: true, lat: true, lng: true, acreage: true, claimedAt: true,
      },
    });

    console.log('[parcels/claim] user', userId, 'parcel', parcelKey, '->', ownerMatchStatus);
    return NextResponse.json({ ok: true, claim, status: ownerMatchStatus, listable });
  } catch (err: any) {
    console.error('[parcels/claim] POST error:', err?.message || err);
    return NextResponse.json({ error: 'Could not record the claim. Please try again.' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) return NextResponse.json({ claims: [] });

    const claims = await prisma.parcelClaim.findMany({
      where: { userId },
      orderBy: { claimedAt: 'desc' },
      select: {
        id: true, parcelKey: true, ownerMatchStatus: true, listable: true,
        regridOwnerName: true, address: true, lat: true, lng: true, acreage: true, claimedAt: true,
      },
    });
    return NextResponse.json({ claims });
  } catch (err: any) {
    console.error('[parcels/claim] GET error:', err?.message || err);
    return NextResponse.json({ claims: [] });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parcelKey = (new URL(req.url).searchParams.get('parcelKey') || '').trim();
    if (!parcelKey) return NextResponse.json({ error: 'Missing parcelKey' }, { status: 400 });

    await prisma.parcelClaim.deleteMany({ where: { userId, parcelKey } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[parcels/claim] DELETE error:', err?.message || err);
    return NextResponse.json({ error: 'Could not remove the claim.' }, { status: 500 });
  }
}
