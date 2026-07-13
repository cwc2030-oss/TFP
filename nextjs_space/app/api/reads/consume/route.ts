export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { READS_PER_SEASON, getCurrentSeason, isReadsUnlocked } from '@/lib/reads';

/**
 * POST /api/reads/consume
 * Body: { parcelKey: string, address?, lat?, lng?, savedPropertyId? }
 *
 * Authoritative gate for a Terrain Brain read. Called by /intel right before
 * the full flow analysis fires. Possible statuses:
 *  - anonymous : no session         -> allow:false (client shows signup prompt)
 *  - unlocked  : Season Pass / Pro   -> allow:true  (never metered)
 *  - saved     : own saved ground    -> allow:true  (read-only view, never walled)
 *  - revisit   : already read parcel -> allow:true  (no new read consumed)
 *  - ok        : new read within cap -> allow:true  (read recorded)
 *  - wall      : cap reached         -> allow:false (client shows the wall)
 *
 * Piece 6c: a lapsed/free user must always be able to REVIEW ground they saved.
 * When the client passes a savedPropertyId, we verify server-side that the
 * signed-in user actually owns it and, if so, allow the flow read-only without
 * consuming a read or ever showing the wall — regardless of lock state. This
 * keeps a single authoritative gate (ownership is checked here, not trusted
 * from a client flag) so "never lock a user's own saved ground" holds.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    const season = getCurrentSeason();

    if (!userId) {
      return NextResponse.json({
        allow: false,
        status: 'anonymous',
        authenticated: false,
        unlocked: false,
        used: 0,
        limit: READS_PER_SEASON,
      });
    }

    const body = await req.json().catch(() => ({}));
    const parcelKey: string = (body?.parcelKey || '').toString().trim();
    const address: string | undefined = body?.address ? String(body.address).slice(0, 300) : undefined;
    const lat = typeof body?.lat === 'number' ? body.lat : undefined;
    const lng = typeof body?.lng === 'number' ? body.lng : undefined;
    const savedPropertyId: string = (body?.savedPropertyId || '').toString().trim();

    // Piece 6c — own saved ground stays viewable after a pass lapses. If the
    // client is opening one of THIS user's saved properties, verify ownership
    // server-side and let the flow run read-only: never consume a read, never
    // wall, no matter the lock state.
    if (savedPropertyId) {
      const owned = await prisma.savedProperty.findFirst({
        where: { id: savedPropertyId, userId },
        select: { id: true },
      });
      if (owned) {
        const used = await prisma.parcelRead.count({ where: { userId, season } });
        return NextResponse.json({
          allow: true, status: 'saved', authenticated: true,
          unlocked: isReadsUnlocked(
            await prisma.user.findUnique({
              where: { id: userId },
              select: { readsUnlocked: true, subscriptionStatus: true, role: true, seasonPassSeason: true, seasonPassExpiry: true },
            }),
          ),
          used, limit: READS_PER_SEASON,
        });
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { readsUnlocked: true, subscriptionStatus: true, role: true, seasonPassSeason: true, seasonPassExpiry: true },
    });
    const unlocked = isReadsUnlocked(user);

    if (unlocked) {
      return NextResponse.json({
        allow: true,
        status: 'unlocked',
        authenticated: true,
        unlocked: true,
        used: 0,
        limit: READS_PER_SEASON,
      });
    }

    if (!parcelKey) {
      // Without a stable key we can't dedupe revisits; fail-open to avoid
      // double-charging a read on a malformed request.
      const used = await prisma.parcelRead.count({ where: { userId, season } });
      return NextResponse.json({
        allow: true, status: 'ok', authenticated: true, unlocked: false,
        used, limit: READS_PER_SEASON,
      });
    }

    // Already read this parcel this season? -> free revisit, no decrement.
    const existing = await prisma.parcelRead.findUnique({
      where: { userId_parcelKey_season: { userId, parcelKey, season } },
    });
    if (existing) {
      const used = await prisma.parcelRead.count({ where: { userId, season } });
      return NextResponse.json({
        allow: true, status: 'revisit', authenticated: true, unlocked: false,
        used, limit: READS_PER_SEASON,
      });
    }

    // New parcel — check the cap.
    const used = await prisma.parcelRead.count({ where: { userId, season } });
    if (used >= READS_PER_SEASON) {
      return NextResponse.json({
        allow: false, status: 'wall', authenticated: true, unlocked: false,
        used, limit: READS_PER_SEASON,
      });
    }

    // Record the read. Guard against a race with a unique-constraint catch.
    try {
      await prisma.parcelRead.create({
        data: { userId, parcelKey, season, address, lat, lng },
      });
    } catch (e) {
      // Concurrent create for the same parcel -> treat as revisit (no extra read).
      const nowUsed = await prisma.parcelRead.count({ where: { userId, season } });
      return NextResponse.json({
        allow: true, status: 'revisit', authenticated: true, unlocked: false,
        used: nowUsed, limit: READS_PER_SEASON,
      });
    }

    return NextResponse.json({
      allow: true, status: 'ok', authenticated: true, unlocked: false,
      used: used + 1, limit: READS_PER_SEASON,
    });
  } catch (err) {
    console.error('[reads/consume] error:', err);
    // Fail-open: never let a metering hiccup break the hero flow.
    return NextResponse.json({ allow: true, status: 'error', authenticated: true, unlocked: false, used: 0, limit: READS_PER_SEASON });
  }
}
